/* eslint-disable no-console */
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

function getArgFlag(name) {
  return process.argv.includes(name);
}

async function main() {
  // Use service account if provided to infer projectId.
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

  console.log("Starting migration...");
  console.log("deleteOld:", deleteOld);

  const brandsSnap = await db.collection("brands").get();
  const modelsSnap = await db.collection("models").get();
  const categoriesSnap = await db.collection("categories").get();
  const subCategoriesSnap = await db.collection("subCategories").get();

  const categoriesById = new Map();
  categoriesSnap.docs.forEach((d) => categoriesById.set(d.id, d.data()));

  const subCategoriesById = new Map();
  subCategoriesSnap.docs.forEach((d) => subCategoriesById.set(d.id, d.data()));

  let createdCategories = 0;
  let createdSubCategories = 0;

  for (const b of brandsSnap.docs) {
    const id = b.id;
    if (categoriesById.has(id)) continue;
    const data = b.data() || {};

    await db.collection("categories").doc(id).set(
      {
        name: data.name || "Kategori",
        nameLower: data.nameLower || (data.name || "Kategori").toLowerCase(),
        order: typeof data.order === "number" ? data.order : 0,
        slug: data.slug || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: false }
    );
    createdCategories++;
  }

  for (const m of modelsSnap.docs) {
    const id = m.id;
    if (subCategoriesById.has(id)) continue;
    const data = m.data() || {};

    await db.collection("subCategories").doc(id).set(
      {
        name: data.name || "Alt kategori",
        nameLower: data.nameLower || (data.name || "Alt kategori").toLowerCase(),
        order: typeof data.order === "number" ? data.order : 0,
        slug: data.slug || "",
        categoryId: data.brandId || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: false }
    );
    createdSubCategories++;
  }

  const listingsSnap = await db.collection("listings").get();
  let updatedListings = 0;
  let batch = db.batch();
  let opCount = 0;

  const commitIfNeeded = async () => {
    if (opCount >= 450) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  };

  for (const l of listingsSnap.docs) {
    const data = l.data() || {};
    const categoryId = data.categoryId || data.brandId || "";
    const subCategoryId = data.subCategoryId || data.modelId || "";
    const categoryName = data.categoryName || data.brandName || "";
    const subCategoryName = data.subCategoryName || data.modelName || "";

    if (categoryId || subCategoryId) {
      const payload = {
        categoryId,
        subCategoryId,
        categoryName,
        subCategoryName,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (deleteOld) {
        payload.brandId = admin.firestore.FieldValue.delete();
        payload.modelId = admin.firestore.FieldValue.delete();
        payload.brandName = admin.firestore.FieldValue.delete();
        payload.modelName = admin.firestore.FieldValue.delete();
      }

      batch.update(l.ref, payload);
      opCount++;
      updatedListings++;
      await commitIfNeeded();
    }
  }

  if (opCount > 0) {
    await batch.commit();
  }

  const schemasSnap = await db.collection("listingSchemas").get();
  for (const s of schemasSnap.docs) {
    const data = s.data() || {};
    if (!data.categoryId) {
      await s.ref.set(
        {
          categoryId: s.id,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }

  if (deleteOld) {
    console.log("Deleting old collections (brands, models)...");
    for (const b of brandsSnap.docs) await b.ref.delete();
    for (const m of modelsSnap.docs) await m.ref.delete();
  }

  console.log("Done.");
  console.log({
    createdCategories,
    createdSubCategories,
    updatedListings,
    deleteOld,
  });
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
