/* eslint-disable no-console */
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

function getArgFlag(name) {
  return process.argv.includes(name);
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
  const deleteOld = getArgFlag("--delete-old");

  console.log("Starting subCategories -> categories migration...");
  console.log("deleteOld:", deleteOld);

  const categoriesSnap = await db.collection("categories").get();
  const subCategoriesSnap = await db.collection("subCategories").get();

  const categoriesById = new Map();
  categoriesSnap.docs.forEach((d) => categoriesById.set(d.id, d.data()));

  let created = 0;
  let updated = 0;

  for (const s of subCategoriesSnap.docs) {
    const id = s.id;
    const data = s.data() || {};
    const payload = {
      name: data.name || "Alt kategori",
      nameLower: data.nameLower || (data.name || "Alt kategori").toLowerCase(),
      order: typeof data.order === "number" ? data.order : 0,
      slug: data.slug || "",
      enabled: data.enabled !== false,
      parentId: data.categoryId || "",
      createdAt: data.createdAt || admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (typeof data.icon === "string" && data.icon.trim()) {
      payload.icon = data.icon.trim();
    }

    if (categoriesById.has(id)) {
      await db.collection("categories").doc(id).set(payload, { merge: true });
      updated++;
    } else {
      await db.collection("categories").doc(id).set(payload, { merge: false });
      created++;
    }
  }

  if (deleteOld) {
    console.log("Deleting old collection: subCategories");
    for (const s of subCategoriesSnap.docs) await s.ref.delete();
  }

  console.log("Done.");
  console.log({ created, updated, deleteOld });
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
