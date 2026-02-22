/* eslint-disable no-console */
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

function hasFlag(name) {
  return process.argv.includes(name);
}

function getArgValue(prefix) {
  const hit = process.argv.find((a) => a.startsWith(`${prefix}=`));
  if (!hit) return "";
  return hit.slice(prefix.length + 1).trim();
}

function normalizeSpaces(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function cleanLocationToken(v) {
  return normalizeSpaces(v || "").replace(/^[-|/\\]+|[-|/\\]+$/g, "");
}

function isPostalCodeToken(v) {
  return /^\d{5}$/.test(String(v || "").trim());
}

function isCountryToken(v) {
  const n = cleanLocationToken(v).toLocaleLowerCase("tr-TR");
  return (
    n === "turkiye" ||
    n === "türkiye" ||
    n === "turkey" ||
    n === "turkiye cumhuriyeti" ||
    n === "türkiye cumhuriyeti"
  );
}

function isRegionToken(v) {
  const n = cleanLocationToken(v).toLocaleLowerCase("tr-TR");
  return n.includes("bölgesi") || n.includes("bolgesi") || n.includes("region");
}

function isUsefulLocationToken(v) {
  const token = cleanLocationToken(v);
  if (!token) return false;
  if (/^\d+$/.test(token)) return false;
  if (isCountryToken(token) || isRegionToken(token) || isPostalCodeToken(token)) {
    return false;
  }
  return true;
}

function hasValidLocation(loc) {
  return !!(
    loc &&
    Number.isFinite(Number(loc.lat)) &&
    Number.isFinite(Number(loc.lng))
  );
}

function roundCoord(value, precision = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** precision;
  return Math.round(n * factor) / factor;
}

function normalizeLocation(loc, fallbackAddress) {
  if (!hasValidLocation(loc)) return null;
  return {
    lat: roundCoord(Number(loc.lat), 4),
    lng: roundCoord(Number(loc.lng), 4),
  };
}

function extractCityDistrict(address) {
  const cleaned = normalizeSpaces(address);
  if (!cleaned) return { city: "", district: "" };

  const parts = cleaned
    .split(",")
    .map((p) => cleanLocationToken(p))
    .filter(Boolean);

  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (!part.includes("/")) continue;
    const slashParts = part
      .split("/")
      .map((p) => cleanLocationToken(p))
      .filter(isUsefulLocationToken);
    const slashAlphaParts = slashParts.filter((p) =>
      /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(p)
    );
    if (slashAlphaParts.length >= 2) {
      return {
        district: slashAlphaParts[slashAlphaParts.length - 2],
        city: slashAlphaParts[slashAlphaParts.length - 1],
      };
    }
  }

  const meaningful = parts.filter(isUsefulLocationToken);
  if (meaningful.length >= 2) {
    return {
      district: meaningful[meaningful.length - 2],
      city: meaningful[meaningful.length - 1],
    };
  }

  return { city: meaningful[0] || "", district: "" };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeAddress(address) {
  const q = normalizeSpaces(address);
  if (!q) return null;

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
    q
  )}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "kutukafa/1.0 (backfill-listing-locations)",
        "Accept-Language": "tr-TR",
      },
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const lat = Number(data[0]?.lat);
    const lng = Number(data[0]?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return {
      lat,
      lng,
      address: normalizeSpaces(data[0]?.display_name || q),
    };
  } catch {
    return null;
  }
}

async function main() {
  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!saPath) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS not set. Please set it to your serviceAccountKey.json path."
    );
  }

  const raw = fs.readFileSync(path.resolve(saPath), "utf8");
  const serviceAccount = JSON.parse(raw);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });

  const db = admin.firestore();
  const dryRun = hasFlag("--dry-run");
  const geocodeMissing = hasFlag("--geocode-missing");
  const force = hasFlag("--force");
  const limitRaw = Number(getArgValue("--limit"));
  const maxToProcess = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 0;

  console.log("Starting listing location backfill...");
  console.log({ dryRun, geocodeMissing, force, maxToProcess: maxToProcess || "all" });

  const ownerCache = new Map();
  const geoCache = new Map();

  async function getOwnerMeta(uid) {
    if (!uid) return { address: "", location: null };
    if (ownerCache.has(uid)) return ownerCache.get(uid);

    const [privateSnap, publicSnap, userSnap] = await Promise.all([
      db.collection("privateProfiles").doc(uid).get(),
      db.collection("publicProfiles").doc(uid).get(),
      db.collection("users").doc(uid).get(),
    ]);

    const privateData = privateSnap.exists ? privateSnap.data() || {} : {};
    const publicData = publicSnap.exists ? publicSnap.data() || {} : {};
    const userData = userSnap.exists ? userSnap.data() || {} : {};

    const address = normalizeSpaces(
      privateData.address || publicData.address || userData.address || ""
    );
    const location = normalizeLocation(privateData.location, address);

    const out = { address, location };
    ownerCache.set(uid, out);
    return out;
  }

  const pageSize = 300;
  let lastDoc = null;

  let scanned = 0;
  let updated = 0;
  let skippedNoOwner = 0;
  let skippedNoAddress = 0;
  let geocoded = 0;

  let batch = db.batch();
  let batchOps = 0;

  const commitBatch = async () => {
    if (batchOps === 0) return;
    if (!dryRun) await batch.commit();
    batch = db.batch();
    batchOps = 0;
  };

  while (true) {
    let q = db.collection("listings").orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    for (const listingDoc of snap.docs) {
      scanned += 1;
      if (maxToProcess > 0 && scanned > maxToProcess) break;

      const data = listingDoc.data() || {};
      const ownerId = normalizeSpaces(data.ownerId || "");
      if (!ownerId) {
        skippedNoOwner += 1;
        continue;
      }

      const owner = await getOwnerMeta(ownerId);
      const existingLocation = normalizeLocation(data.location);

      let location = existingLocation || owner.location || null;
      const fallbackAddress = normalizeSpaces(
        data.locationAddress ||
          data.location?.address ||
          owner.address ||
          ""
      );

      if (!location && geocodeMissing && fallbackAddress) {
        const cacheKey = fallbackAddress.toLocaleLowerCase("tr-TR");
        if (geoCache.has(cacheKey)) {
          location = geoCache.get(cacheKey);
        } else {
          await sleep(1100);
          const geo = await geocodeAddress(fallbackAddress);
          if (geo) {
            geocoded += 1;
            location = geo;
            geoCache.set(cacheKey, geo);
          } else {
            geoCache.set(cacheKey, null);
          }
        }
      }

      const locationLabel = normalizeSpaces(
        data.locationAddress ||
          data.location?.address ||
          owner.address ||
          (location && location.address) ||
          ""
      );

      if (!locationLabel && !location) {
        skippedNoAddress += 1;
        continue;
      }

      const parsed = extractCityDistrict(locationLabel);
      const payload = {};

      if ((force || !hasValidLocation(data.location) || data.location?.address) && location) {
        payload.location = {
          lat: roundCoord(Number(location.lat), 4),
          lng: roundCoord(Number(location.lng), 4),
        };
      }

      if (Object.prototype.hasOwnProperty.call(data, "locationAddress")) {
        payload.locationAddress = admin.firestore.FieldValue.delete();
      }

      if ((force || !normalizeSpaces(data.locationCity)) && parsed.city) {
        payload.locationCity = parsed.city;
      }

      if ((force || !normalizeSpaces(data.locationDistrict)) && parsed.district) {
        payload.locationDistrict = parsed.district;
      }

      if (Object.keys(payload).length === 0) continue;

      payload.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      updated += 1;

      if (!dryRun) {
        batch.set(listingDoc.ref, payload, { merge: true });
        batchOps += 1;
        if (batchOps >= 400) {
          await commitBatch();
        }
      }
    }

    if (maxToProcess > 0 && scanned >= maxToProcess) {
      break;
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  await commitBatch();

  console.log("Done.");
  console.log({
    scanned,
    updated,
    skippedNoOwner,
    skippedNoAddress,
    geocoded,
    dryRun,
    geocodeMissing,
    force,
  });
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
