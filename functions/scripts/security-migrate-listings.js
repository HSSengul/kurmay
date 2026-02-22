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

function sanitizeRegionValue(v) {
  const token = cleanLocationToken(v);
  return isUsefulLocationToken(token) ? token : "";
}

function extractCityDistrict(address) {
  const cleaned = normalizeSpaces(address || "");
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

function roundCoord(value, precision = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** precision;
  return Math.round(n * factor) / factor;
}

function normalizeStatus(value) {
  return normalizeSpaces(value).toLowerCase();
}

const ADMIN_STATUSES = new Set(["active", "review", "hidden", "removed"]);
const STATUS_VALUES = new Set(["active", "review", "hidden", "removed", "draft", "sold"]);

function getDesiredAdminStatus(data) {
  const current = normalizeStatus(data.adminStatus);
  if (ADMIN_STATUSES.has(current)) return current;
  return "active";
}

function getDesiredStatus(data, desiredAdminStatus) {
  if (desiredAdminStatus !== "active") return desiredAdminStatus;
  const current = normalizeStatus(data.status);
  if (STATUS_VALUES.has(current)) return current;
  return "active";
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
  const limitRaw = Number(getArgValue("--limit"));
  const maxToProcess = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 0;

  const pageSize = 400;
  let lastDoc = null;

  let scanned = 0;
  let updated = 0;
  let moderationSynced = 0;
  let locationSanitized = 0;

  let batch = db.batch();
  let batchOps = 0;

  const commitBatch = async () => {
    if (batchOps === 0) return;
    if (!dryRun) await batch.commit();
    batch = db.batch();
    batchOps = 0;
  };

  console.log("Starting listing security migration...");
  console.log({ dryRun, maxToProcess: maxToProcess || "all" });

  while (true) {
    let q = db
      .collection("listings")
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    for (const listingDoc of snap.docs) {
      scanned += 1;
      if (maxToProcess > 0 && scanned > maxToProcess) break;

      const data = listingDoc.data() || {};
      const payload = {};
      let changed = false;
      let moderationChanged = false;
      let locationChanged = false;

      const desiredAdminStatus = getDesiredAdminStatus(data);
      const currentAdminStatus = normalizeStatus(data.adminStatus);
      if (currentAdminStatus !== desiredAdminStatus) {
        payload.adminStatus = desiredAdminStatus;
        changed = true;
        moderationChanged = true;
      }

      const desiredStatus = getDesiredStatus(data, desiredAdminStatus);
      const currentStatus = normalizeStatus(data.status);
      if (currentStatus !== desiredStatus) {
        payload.status = desiredStatus;
        changed = true;
        moderationChanged = true;
      }

      const loc = data.location;
      const lat = roundCoord(loc?.lat, 4);
      const lng = roundCoord(loc?.lng, 4);
      const hasValidLocation = lat !== null && lng !== null;
      const hasLocationMap = loc && typeof loc === "object";
      const hasLocationAddress = normalizeSpaces(loc?.address || "") !== "";

      if (hasValidLocation) {
        const nextLocation = { lat, lng };
        if (
          !hasLocationMap ||
          roundCoord(loc?.lat, 4) !== lat ||
          roundCoord(loc?.lng, 4) !== lng ||
          hasLocationAddress ||
          Object.keys(loc).some((k) => k !== "lat" && k !== "lng")
        ) {
          payload.location = nextLocation;
          changed = true;
          locationChanged = true;
        }
      } else if (hasLocationMap) {
        payload.location = admin.firestore.FieldValue.delete();
        changed = true;
        locationChanged = true;
      }

      if (Object.prototype.hasOwnProperty.call(data, "locationAddress")) {
        payload.locationAddress = admin.firestore.FieldValue.delete();
        changed = true;
        locationChanged = true;
      }

      const rawAddress = normalizeSpaces(
        data.locationAddress || loc?.address || ""
      );
      const parsed = extractCityDistrict(rawAddress);

      const desiredCity =
        sanitizeRegionValue(data.locationCity || "") ||
        sanitizeRegionValue(parsed.city || "") ||
        null;
      const desiredDistrict =
        sanitizeRegionValue(data.locationDistrict || "") ||
        sanitizeRegionValue(parsed.district || "") ||
        null;

      const currentCity = normalizeSpaces(data.locationCity || "") || null;
      const currentDistrict = normalizeSpaces(data.locationDistrict || "") || null;

      if (currentCity !== desiredCity) {
        payload.locationCity = desiredCity;
        changed = true;
        locationChanged = true;
      }
      if (currentDistrict !== desiredDistrict) {
        payload.locationDistrict = desiredDistrict;
        changed = true;
        locationChanged = true;
      }

      if (!changed) continue;

      payload.updatedAt = admin.firestore.FieldValue.serverTimestamp();

      updated += 1;
      if (moderationChanged) moderationSynced += 1;
      if (locationChanged) locationSanitized += 1;

      if (!dryRun) {
        batch.set(listingDoc.ref, payload, { merge: true });
        batchOps += 1;
        if (batchOps >= 400) {
          await commitBatch();
        }
      }
    }

    if (maxToProcess > 0 && scanned >= maxToProcess) break;

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  await commitBatch();

  console.log("Done.");
  console.log({
    scanned,
    updated,
    moderationSynced,
    locationSanitized,
    dryRun,
  });
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

