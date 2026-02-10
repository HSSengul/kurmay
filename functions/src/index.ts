import { setGlobalOptions } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

/**
 * One-time migration: brands/models -> categories/subCategories
 * - Copies brands -> categories
 * - Copies models -> subCategories (categoryId = brandId)
 * - Updates listings to categoryId/subCategoryId fields
 * - Optionally deletes old collections and old fields
 */
export const migrateToCategories = onCall(
  { cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "GiriÅŸ gerekli.");

    const ok = await isAdminUid(uid);
    if (!ok) throw new HttpsError("permission-denied", "Sadece admin.");

    const deleteOld = !!request.data?.deleteOld;
    const db = admin.firestore();

    const brandsSnap = await db.collection("brands").get();
    const modelsSnap = await db.collection("models").get();
    const categoriesSnap = await db.collection("categories").get();
    const subCategoriesSnap = await db.collection("subCategories").get();

    const categoriesById = new Map<string, any>();
    categoriesSnap.docs.forEach((d) => categoriesById.set(d.id, d.data()));

    const subCategoriesById = new Map<string, any>();
    subCategoriesSnap.docs.forEach((d) =>
      subCategoriesById.set(d.id, d.data())
    );

    let createdCategories = 0;
    let createdSubCategories = 0;

    for (const b of brandsSnap.docs) {
      const id = b.id;
      if (categoriesById.has(id)) continue;
      const data = b.data() as any;
      await db.collection("categories").doc(id).set(
        {
          name: data?.name || "Kategori",
          nameLower: data?.nameLower || normalizeLowerTR(data?.name || "kategori"),
          order: typeof data?.order === "number" ? data.order : 0,
          slug: data?.slug || "",
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
      const data = m.data() as any;
      await db.collection("subCategories").doc(id).set(
        {
          name: data?.name || "Alt kategori",
          nameLower:
            data?.nameLower ||
            normalizeLowerTR(data?.name || "alt kategori"),
          order: typeof data?.order === "number" ? data.order : 0,
          slug: data?.slug || "",
          categoryId: data?.brandId || "",
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
      const data = l.data() as any;
      const categoryId = data.categoryId || data.brandId || "";
      const subCategoryId = data.subCategoryId || data.modelId || "";
      const categoryName = data.categoryName || data.brandName || "";
      const subCategoryName = data.subCategoryName || data.modelName || "";

      if (categoryId || subCategoryId) {
        const payload: Record<string, any> = {
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
      const data = s.data() as any;
      if (!data?.categoryId) {
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
      for (const b of brandsSnap.docs) {
        await b.ref.delete();
      }
      for (const m of modelsSnap.docs) {
        await m.ref.delete();
      }
    }

    return {
      ok: true,
      createdCategories,
      createdSubCategories,
      updatedListings,
      deleteOld,
    };
  }
);

/* ============================================================
   ✅ HELPERS (YOL B: adminStatsDaily + adminStats/global + autoFlags)
============================================================ */

function getDateKeyTRFromMillis(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
}

function toDateKeyTR(input: any): string {
  if (!input) return getDateKeyTRFromMillis(Date.now());

  // Firestore Timestamp
  if (typeof input?.toMillis === "function") {
    return getDateKeyTRFromMillis(input.toMillis());
  }

  // JS Date
  if (input instanceof Date) {
    return getDateKeyTRFromMillis(input.getTime());
  }

  // { seconds: ... }
  if (typeof input?.seconds === "number") {
    return getDateKeyTRFromMillis(input.seconds * 1000);
  }

  return getDateKeyTRFromMillis(Date.now());
}

async function incDailyStat(dateKey: string, fields: Record<string, number>) {
  const db = admin.firestore();
  const ref = db.collection("adminStatsDaily").doc(dateKey);

  const payload: Record<string, any> = {
    dateKey,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  for (const [k, v] of Object.entries(fields || {})) {
    payload[k] = admin.firestore.FieldValue.increment(v);
  }

  await ref.set(payload, { merge: true });
}

async function incGlobalStat(fields: Record<string, number>) {
  const db = admin.firestore();
  const ref = db.collection("adminStats").doc("global");

  const payload: Record<string, any> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  for (const [k, v] of Object.entries(fields || {})) {
    payload[k] = admin.firestore.FieldValue.increment(v);
  }

  await ref.set(payload, { merge: true });
}

/* =========================
   Admin policy cache
========================= */

type AdminPolicy = {
  lowPriceThresholdTry: number;
  newAccountDays: number;
  newAccountListingsThreshold: number;
  bannedWords: string[];
};

let policyCache: AdminPolicy | null = null;
let policyCacheAt = 0;

async function getAdminPolicy(): Promise<AdminPolicy> {
  const now = Date.now();
  if (policyCache && now - policyCacheAt < 5 * 60 * 1000) {
    return policyCache;
  }

  const db = admin.firestore();
  const ref = db.collection("adminSettings").doc("policy");
  const snap = await ref.get();

  const fallback: AdminPolicy = {
    lowPriceThresholdTry: 5000,
    newAccountDays: 3,
    newAccountListingsThreshold: 3,
    bannedWords: ["sahte", "replika", "çakma", "fake", "1:1", "replica"],
  };

  if (!snap.exists) {
    await ref.set(
      {
        ...fallback,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    policyCache = fallback;
    policyCacheAt = now;
    return fallback;
  }

  const data = snap.data() as any;

  const policy: AdminPolicy = {
    lowPriceThresholdTry:
      typeof data.lowPriceThresholdTry === "number"
        ? data.lowPriceThresholdTry
        : fallback.lowPriceThresholdTry,
    newAccountDays:
      typeof data.newAccountDays === "number"
        ? data.newAccountDays
        : fallback.newAccountDays,
    newAccountListingsThreshold:
      typeof data.newAccountListingsThreshold === "number"
        ? data.newAccountListingsThreshold
        : fallback.newAccountListingsThreshold,
    bannedWords: Array.isArray(data.bannedWords)
      ? data.bannedWords
      : fallback.bannedWords,
  };

  policyCache = policy;
  policyCacheAt = now;
  return policy;
}

function includesBannedWord(text: string, bannedWords: string[]) {
  if (!text || !Array.isArray(bannedWords) || bannedWords.length === 0)
    return null;

  const lower = String(text).toLocaleLowerCase("tr-TR");
  for (const w of bannedWords) {
    const ww = String(w || "").toLocaleLowerCase("tr-TR");
    if (ww && lower.includes(ww)) return w;
  }
  return null;
}

/**
 * ✅ AutoFlag Upsert (createdAt bozulmaz)
 * - ilk kez ise: ref.create(...)
 * - varsa: merge update (createdAt yok)
 */
async function upsertAutoFlag(params: {
  flagId: string;
  type:
    | "lowPrice"
    | "bannedWordsListing"
    | "bannedWordsMessage"
    | "newAccountHighActivity";
  severity: "low" | "medium" | "high";
  status?: "open" | "resolved" | "investigating";
  targetType: "listing" | "user" | "message";
  targetId: string;
  targetPath: string;
  sampleText?: string;
  meta?: Record<string, any>;
}) {
  const db = admin.firestore();
  const ref = db.collection("autoFlags").doc(params.flagId);

  const baseData = {
    type: params.type,
    severity: params.severity,
    status: params.status ?? "open",

    targetType: params.targetType,
    targetId: params.targetId,
    targetPath: params.targetPath,

    sampleText: params.sampleText ?? null,
    meta: params.meta ?? {},

    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // 1) create -> sadece ilk kez
  try {
    await ref.create({
      ...baseData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return;
  } catch (e: any) {
    // Already exists -> update merge
  }

  // 2) doc varsa: createdAt'e dokunmadan merge set
  await ref.set(baseData, { merge: true });
}

/* ============================================================
   ✅ NEW: LISTING SCHEMAS AUTO-SEED SYSTEM
   - categories/{categoryId} eklenince listingSchemas/{categoryId} otomatik oluşur
   - her gün seed: eksik varsa tamamlar
   - callable seed: admin istersen panelden tek tuş tetikleyebilirsin
============================================================ */

/* ================= TYPES ================= */

type SchemaOption = { value: string; label: string };

type SchemaField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "multiselect" | "boolean";
  required?: boolean;
  sectionId: "details" | "condition";
  placeholder?: string;
  helpText?: string;
  min?: number;
  max?: number;
  options?: SchemaOption[];
};

type ListingSchemaDoc = {
  schemaVersion: number;
  categoryName: string;
  isActive: boolean;
  sections: { id: "details" | "condition"; title: string; order: number }[];
  fields: SchemaField[];
  createdAt?: any;
  updatedAt?: any;
};

/* ================= HELPERS ================= */

function safeString(v: any, fallback = ""): string {
  const s = typeof v === "string" ? v : "";
  return s.trim() ? s : fallback;
}

function normalizeLowerTR(v: string) {
  return (v || "").toLocaleLowerCase("tr-TR").trim();
}

function buildSchemaFieldsByCategoryNameLower(nameLower: string): SchemaField[] {
  const n = normalizeLowerTR(nameLower || "");

  // Her şeyde ortak condition alanları
  const COMMON_CONDITION: SchemaField[] = [
    {
      key: "condition",
      label: "Ürün durumu",
      type: "select",
      required: true,
      sectionId: "condition",
      options: [
        { value: "new", label: "Sıfır / Kapalı kutu" },
        { value: "likeNew", label: "Çok az kullanılmış" },
        { value: "used", label: "Kullanılmış" },
        { value: "heavyUsed", label: "Yıpranmış" },
      ],
    },
    {
      key: "hasBox",
      label: "Kutu var mı?",
      type: "boolean",
      required: false,
      sectionId: "condition",
    },
    {
      key: "hasInvoice",
      label: "Fatura / belge var mı?",
      type: "boolean",
      required: false,
      sectionId: "condition",
    },
  ];

  // =========================
  // KUTU OYUNU
  // =========================
  if (n.includes("kutu") || n.includes("board")) {
    return [
      {
        key: "playersMin",
        label: "Min oyuncu",
        type: "number",
        required: true,
        sectionId: "details",
        min: 1,
        max: 20,
      },
      {
        key: "playersMax",
        label: "Max oyuncu",
        type: "number",
        required: true,
        sectionId: "details",
        min: 1,
        max: 20,
      },
      {
        key: "playTimeMin",
        label: "Min süre (dk)",
        type: "number",
        required: false,
        sectionId: "details",
        min: 1,
        max: 600,
      },
      {
        key: "playTimeMax",
        label: "Max süre (dk)",
        type: "number",
        required: false,
        sectionId: "details",
        min: 1,
        max: 600,
      },
      {
        key: "ageMin",
        label: "Minimum yaş",
        type: "number",
        required: false,
        sectionId: "details",
        min: 3,
        max: 99,
      },
      {
        key: "language",
        label: "Dil",
        type: "select",
        required: true,
        sectionId: "details",
        options: [
          { value: "TR", label: "Türkçe" },
          { value: "EN", label: "İngilizce" },
          { value: "DE", label: "Almanca" },
          { value: "OTHER", label: "Diğer" },
        ],
      },
      {
        key: "missingPieces",
        label: "Eksik parça var mı?",
        type: "boolean",
        required: true,
        sectionId: "condition",
      },
      {
        key: "expansionsIncluded",
        label: "Ek paket / expansion dahil mi?",
        type: "boolean",
        required: false,
        sectionId: "details",
      },
      ...COMMON_CONDITION,
    ];
  }

  // =========================
  // TCG / KOLEKSİYON KART
  // =========================
  if (n.includes("tcg") || n.includes("koleksiyon kart") || n.includes("kart koleksiyon")) {
    return [
      {
        key: "tcgName",
        label: "TCG",
        type: "select",
        required: true,
        sectionId: "details",
        options: [
          { value: "pokemon", label: "Pokémon" },
          { value: "yugioh", label: "Yu-Gi-Oh!" },
          { value: "mtg", label: "Magic: The Gathering" },
          { value: "lorcana", label: "Lorcana" },
          { value: "other", label: "Diğer" },
        ],
      },
      {
        key: "itemType",
        label: "Ürün tipi",
        type: "select",
        required: true,
        sectionId: "details",
        options: [
          { value: "single", label: "Tek kart" },
          { value: "deck", label: "Deste" },
          { value: "booster", label: "Booster" },
          { value: "box", label: "Booster Box" },
          { value: "collection", label: "Koleksiyon / Lot" },
        ],
      },
      {
        key: "setName",
        label: "Set / Seri adı",
        type: "text",
        required: false,
        sectionId: "details",
        placeholder: "Örn: Scarlet & Violet",
      },
      {
        key: "rarity",
        label: "Nadirlik",
        type: "select",
        required: false,
        sectionId: "details",
        options: [
          { value: "common", label: "Common" },
          { value: "uncommon", label: "Uncommon" },
          { value: "rare", label: "Rare" },
          { value: "ultra", label: "Ultra Rare" },
          { value: "secret", label: "Secret Rare" },
        ],
      },
      {
        key: "graded",
        label: "Grading var mı?",
        type: "boolean",
        required: false,
        sectionId: "condition",
      },
      {
        key: "gradeCompany",
        label: "Grading firması",
        type: "select",
        required: false,
        sectionId: "condition",
        options: [
          { value: "psa", label: "PSA" },
          { value: "bgs", label: "BGS" },
          { value: "cgc", label: "CGC" },
          { value: "other", label: "Diğer" },
        ],
      },
      {
        key: "gradeScore",
        label: "Grade puanı",
        type: "number",
        required: false,
        sectionId: "condition",
        min: 1,
        max: 10,
      },
      ...COMMON_CONDITION,
    ];
  }

  // =========================
  // KONSOL / RETRO
  // =========================
  if (n.includes("konsol") || n.includes("retro")) {
    return [
      {
        key: "platform",
        label: "Platform",
        type: "select",
        required: true,
        sectionId: "details",
        options: [
          { value: "ps5", label: "PlayStation 5" },
          { value: "ps4", label: "PlayStation 4" },
          { value: "ps3", label: "PlayStation 3" },
          { value: "ps2", label: "PlayStation 2" },
          { value: "ps1", label: "PlayStation 1" },
          { value: "xboxsx", label: "Xbox Series X/S" },
          { value: "xboxone", label: "Xbox One" },
          { value: "switch", label: "Nintendo Switch" },
          { value: "nes", label: "NES" },
          { value: "snes", label: "SNES" },
          { value: "sega", label: "SEGA" },
          { value: "other", label: "Diğer" },
        ],
      },
      {
        key: "revision",
        label: "Sürüm / Revizyon",
        type: "text",
        required: false,
        sectionId: "details",
        placeholder: "Örn: CFI-1216A / SCPH-1002",
      },
      {
        key: "region",
        label: "Bölge",
        type: "select",
        required: false,
        sectionId: "details",
        options: [
          { value: "PAL", label: "PAL" },
          { value: "NTSC-U", label: "NTSC-U" },
          { value: "NTSC-J", label: "NTSC-J" },
        ],
      },
      {
        key: "storageGb",
        label: "Depolama (GB)",
        type: "number",
        required: false,
        sectionId: "details",
        min: 8,
        max: 8000,
      },
      {
        key: "controllersIncluded",
        label: "Kol sayısı",
        type: "number",
        required: false,
        sectionId: "details",
        min: 0,
        max: 10,
      },
      {
        key: "works",
        label: "Çalışıyor mu?",
        type: "boolean",
        required: true,
        sectionId: "condition",
      },
      {
        key: "modded",
        label: "Modlu mu?",
        type: "boolean",
        required: false,
        sectionId: "condition",
      },
      ...COMMON_CONDITION,
    ];
  }

  // =========================
  // OYUN (konsol oyunu vs)
  // =========================
  if (n.includes("oyun")) {
    return [
      {
        key: "platform",
        label: "Platform",
        type: "select",
        required: false,
        sectionId: "details",
        options: [
          { value: "ps5", label: "PS5" },
          { value: "ps4", label: "PS4" },
          { value: "ps3", label: "PS3" },
          { value: "xbox", label: "Xbox" },
          { value: "switch", label: "Switch" },
          { value: "pc", label: "PC" },
          { value: "other", label: "Diğer" },
        ],
      },
      {
        key: "format",
        label: "Format",
        type: "select",
        required: true,
        sectionId: "details",
        options: [
          { value: "disc", label: "Disk" },
          { value: "cartridge", label: "Kartuş" },
          { value: "digital", label: "Dijital kod" },
        ],
      },
      {
        key: "sealed",
        label: "Kapalı kutu mu?",
        type: "boolean",
        required: false,
        sectionId: "condition",
      },
      ...COMMON_CONDITION,
    ];
  }

  // =========================
  // RPG / KİTAP
  // =========================
  if (n.includes("rpg") || n.includes("kural") || n.includes("kitap")) {
    return [
      {
        key: "system",
        label: "Sistem",
        type: "text",
        required: true,
        sectionId: "details",
        placeholder: "Örn: D&D 5e",
      },
      {
        key: "edition",
        label: "Edition / Versiyon",
        type: "text",
        required: false,
        sectionId: "details",
      },
      {
        key: "language",
        label: "Dil",
        type: "select",
        required: false,
        sectionId: "details",
        options: [
          { value: "TR", label: "Türkçe" },
          { value: "EN", label: "İngilizce" },
          { value: "OTHER", label: "Diğer" },
        ],
      },
      ...COMMON_CONDITION,
    ];
  }

  // =========================
  // PUZZLE / ZEKA
  // =========================
  if (n.includes("puzzle") || n.includes("zeka")) {
    return [
      {
        key: "pieces",
        label: "Parça sayısı",
        type: "number",
        required: true,
        sectionId: "details",
        min: 10,
        max: 50000,
      },
      {
        key: "complete",
        label: "Eksiksiz mi?",
        type: "boolean",
        required: true,
        sectionId: "condition",
      },
      ...COMMON_CONDITION,
    ];
  }

  // =========================
  // FİGÜR / EKİPMAN
  // =========================
  if (n.includes("fig") || n.includes("mini") || n.includes("ekipman") || n.includes("aksesuar")) {
    return [
      {
        key: "itemType",
        label: "Ürün tipi",
        type: "select",
        required: true,
        sectionId: "details",
        options: [
          { value: "miniature", label: "Miniature / Figür" },
          { value: "dice", label: "Zar seti" },
          { value: "sleeves", label: "Kart kılıfı" },
          { value: "playmat", label: "Playmat" },
          { value: "tokens", label: "Token / marker" },
          { value: "other", label: "Diğer" },
        ],
      },
      {
        key: "material",
        label: "Malzeme",
        type: "select",
        required: false,
        sectionId: "details",
        options: [
          { value: "plastic", label: "Plastik" },
          { value: "resin", label: "Reçine" },
          { value: "metal", label: "Metal" },
          { value: "wood", label: "Ahşap" },
          { value: "other", label: "Diğer" },
        ],
      },
      {
        key: "painted",
        label: "Boyalı mı?",
        type: "boolean",
        required: false,
        sectionId: "condition",
      },
      ...COMMON_CONDITION,
    ];
  }

  // DEFAULT
  return [...COMMON_CONDITION];
}

function buildListingSchemaDoc(categoryName: string, nameLower: string): ListingSchemaDoc {
  return {
    schemaVersion: 1,
    categoryName: safeString(categoryName, "Kategori"),
    isActive: true,
    sections: [
      { id: "details", title: "Detaylar", order: 1 },
      { id: "condition", title: "Durum", order: 2 },
    ],
    fields: buildSchemaFieldsByCategoryNameLower(nameLower),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function isAdminUid(uid: string): Promise<boolean> {
  if (!uid) return false;
  const db = admin.firestore();
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) return false;
  const data = snap.data() as any;
  return data?.role === "admin";
}

async function seedMissingListingSchemas(): Promise<{
  totalCategories: number;
  created: number;
  alreadyExisting: number;
}> {
  const db = admin.firestore();

  const categoriesSnap = await db.collection("categories").get();
  const schemasSnap = await db.collection("listingSchemas").get();

  const existingIds = new Set(schemasSnap.docs.map((d) => d.id));

  let created = 0;
  const totalCategories = categoriesSnap.size;
  const alreadyExisting = existingIds.size;

  // Batch limit güvenliği
  let batch = db.batch();
  let opCount = 0;

  const commitIfNeeded = async () => {
    if (opCount >= 450) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  };

  for (const b of categoriesSnap.docs) {
    const categoryId = b.id;
    if (!categoryId) continue;

    if (existingIds.has(categoryId)) continue;

    const data = b.data() as any;
    const name = safeString(data?.name, "Kategori");
    const nameLower = safeString(data?.nameLower, normalizeLowerTR(name));

    const schemaRef = db.collection("listingSchemas").doc(categoryId);
    batch.set(schemaRef, buildListingSchemaDoc(name, nameLower), { merge: false });

    opCount++;
    created++;

    await commitIfNeeded();
  }

  if (opCount > 0) {
    await batch.commit();
  }

  return { totalCategories, created, alreadyExisting };
}

/**
 * ✅ Trigger: Yeni kategori eklenince schema otomatik oluşur
 * categories/{categoryId} created => listingSchemas/{categoryId}
 */
export const autoCreateListingSchemaOnCategoryCreated = onDocumentCreated(
  "categories/{categoryId}",
  async (event) => {
    try {
      const categoryId = event.params.categoryId;
      const snap = event.data;
      if (!snap) return;

      const db = admin.firestore();
      const data = snap.data() as any;

      const name = safeString(data?.name, "Kategori");
      const nameLower = safeString(data?.nameLower, normalizeLowerTR(name));

      const ref = db.collection("listingSchemas").doc(categoryId);
      const existing = await ref.get();
      if (existing.exists) {
        return;
      }

      await ref.set(buildListingSchemaDoc(name, nameLower), { merge: false });
      logger.info(`✅ listingSchemas created for categoryId=${categoryId}`);
    } catch (e) {
      logger.error("autoCreateListingSchemaOnCategoryCreated error", e);
    }
  }
);

/**
 * ✅ Scheduled seed: her gün eksik schema varsa tamamlar (sen uğraşmazsın)
 */
export const dailySeedMissingListingSchemas = onSchedule(
  { schedule: "every day 05:00", timeZone: "Europe/Istanbul" },
  async () => {
    try {
      const r = await seedMissingListingSchemas();
      logger.info("✅ dailySeedMissingListingSchemas", r);
    } catch (e) {
      logger.error("dailySeedMissingListingSchemas error", e);
    }
  }
);

/**
 * ✅ Callable seed: Admin panelden tek tuş tetiklemek istersen
 * client -> httpsCallable("seedListingSchemasNow") gibi çağırırsın
 */
export const seedListingSchemasNow = onCall(
  { cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Giriş gerekli.");

    const ok = await isAdminUid(uid);
    if (!ok) throw new HttpsError("permission-denied", "Sadece admin.");

    const r = await seedMissingListingSchemas();
    return { ok: true, ...r };
  }
);

/* ============================================================
   ✅ EXISTING FUNCTIONS (DOKUNMADIM)
============================================================ */

/**
 * 🔥 Typing TTL Cleaner
 * Her 60 saniyede bir çalışır.
 * typing.updatedAt 10 saniyeden eskiyse:
 *   buyer=false
 *   seller=false
 */
export const cleanupStaleTyping = onSchedule("every 1 minutes", async () => {
  const db = admin.firestore();
  const now = Date.now();

  const snapshot = await db
    .collection("conversations")
    .where(
      "typing.updatedAt",
      "<",
      admin.firestore.Timestamp.fromMillis(now - 10000)
    )
    .get();

  if (snapshot.empty) {
    logger.info("No stale typing found");
    return;
  }

  const batch = db.batch();
  let count = 0;

  snapshot.forEach((doc) => {
    const ref = doc.ref;
    batch.update(ref, {
      "typing.buyer": false,
      "typing.seller": false,
    });
    count++;
  });

  await batch.commit();
  logger.info(`Typing cleaned in ${count} conversations`);
});

/**
 * 🧹 Draft Conversation Cleaner
 * Her 10 dakikada bir çalışır.
 * draft=true ve draftExpiresAt <= now ise:
 *   conversation doc'u siler
 */
export const cleanupDraftConversations = onSchedule(
  "every 10 minutes",
  async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    const snapshot = await db
      .collection("conversations")
      .where("draft", "==", true)
      .where("draftExpiresAt", "<=", now)
      .limit(200)
      .get();

    if (snapshot.empty) {
      logger.info("No expired drafts found");
      return;
    }

    const batch = db.batch();
    let count = 0;

    snapshot.forEach((doc) => {
      batch.delete(doc.ref);
      count++;
    });

    await batch.commit();
    logger.info(`Draft cleanup deleted ${count} conversations`);
  }
);

/* ============================================================
   ✅ YOL B: PRE-AGGREGATE + AUTOFLAGS TRIGGERS
============================================================ */

/**
 * users/{uid} created
 * - daily.newUsers++
 * - global.totalUsers++
 */
export const onUserCreated = onDocumentCreated("users/{uid}", async (event) => {
  try {
    const uid = event.params.uid;
    const snap = event.data;
    if (!snap) return;

    const data = snap.data() as any;

    const createdAt =
      data?.createdAt ??
      admin.firestore.Timestamp.fromDate(new Date(event.time));
    const dateKey = toDateKeyTR(createdAt);

    await Promise.all([
      incDailyStat(dateKey, { newUsers: 1 }),
      incGlobalStat({ totalUsers: 1 }),
    ]);

    // bonus counters init
    const db = admin.firestore();
    await db.collection("users").doc(uid).set(
      {
        listingsCount: admin.firestore.FieldValue.increment(0),
        conversationsCount: admin.firestore.FieldValue.increment(0),
        reportsCount: admin.firestore.FieldValue.increment(0),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (e) {
    logger.error("onUserCreated error", e);
  }
});

/**
 * listings/{listingId} created
 * - daily.newListings++
 * - global.totalListings++
 * - autoFlags (lowPrice, bannedWordsListing, newAccountHighActivity)
 */
export const onListingCreated = onDocumentCreated(
  "listings/{listingId}",
  async (event) => {
    try {
      const listingId = event.params.listingId;
      const snap = event.data;
      if (!snap) return;

      const db = admin.firestore();
      const data = snap.data() as any;

      const createdAt =
        data?.createdAt ??
        admin.firestore.Timestamp.fromDate(new Date(event.time));
      const dateKey = toDateKeyTR(createdAt);

      await Promise.all([
        incDailyStat(dateKey, { newListings: 1 }),
        incGlobalStat({ totalListings: 1 }),
      ]);

      // ownerId
      const ownerId =
        data?.ownerId ?? data?.sellerId ?? data?.userId ?? null;

      // users.listingsCount++
      if (ownerId) {
        await db.collection("users").doc(ownerId).set(
          {
            listingsCount: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      const policy = await getAdminPolicy();

      /* ---------- AUTOFLAG: LOW PRICE ---------- */
      const price =
        typeof data?.price === "number"
          ? data.price
          : typeof data?.priceTry === "number"
          ? data.priceTry
          : typeof data?.priceTL === "number"
          ? data.priceTL
          : null;

      if (
        price != null &&
        typeof price === "number" &&
        price > 0 &&
        price < policy.lowPriceThresholdTry
      ) {
        await upsertAutoFlag({
          flagId: `lowPrice_listing_${listingId}`,
          type: "lowPrice",
          severity: "high",
          targetType: "listing",
          targetId: listingId,
          targetPath: `listings/${listingId}`,
          meta: { price, threshold: policy.lowPriceThresholdTry },
        });

        await db.collection("listings").doc(listingId).set(
          {
            riskFlags: admin.firestore.FieldValue.arrayUnion("lowPrice"),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      /* ---------- AUTOFLAG: BANNED WORDS in LISTING DESCRIPTION ---------- */
      const desc = typeof data?.description === "string" ? data.description : "";
      const hitDesc = includesBannedWord(desc, policy.bannedWords);

      if (hitDesc) {
        await upsertAutoFlag({
          flagId: `bannedWordsListing_listing_${listingId}`,
          type: "bannedWordsListing",
          severity: "medium",
          targetType: "listing",
          targetId: listingId,
          targetPath: `listings/${listingId}`,
          sampleText: String(desc).slice(0, 140),
          meta: { word: hitDesc },
        });

        await db.collection("listings").doc(listingId).set(
          {
            riskFlags: admin.firestore.FieldValue.arrayUnion("bannedWords"),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      /* ---------- AUTOFLAG: NEW ACCOUNT HIGH ACTIVITY ---------- */
      if (ownerId) {
        const uSnap = await db.collection("users").doc(ownerId).get();
        if (uSnap.exists) {
          const u = uSnap.data() as any;
          const uCreatedAt = u?.createdAt ?? null;
          const listingsCountBefore =
            typeof u?.listingsCount === "number" ? u.listingsCount : 0;

          const listingsCountAfter = listingsCountBefore + 1;

          if (uCreatedAt && typeof uCreatedAt.toMillis === "function") {
            const diffDays = Math.floor(
              (Date.now() - uCreatedAt.toMillis()) / (24 * 60 * 60 * 1000)
            );

            if (
              diffDays <= policy.newAccountDays &&
              listingsCountAfter >= policy.newAccountListingsThreshold
            ) {
              await upsertAutoFlag({
                flagId: `newAccountHighActivity_user_${ownerId}`,
                type: "newAccountHighActivity",
                severity: "high",
                targetType: "user",
                targetId: ownerId,
                targetPath: `users/${ownerId}`,
                meta: {
                  diffDays,
                  listingsCountAfter,
                  newAccountDays: policy.newAccountDays,
                  thresholdListings: policy.newAccountListingsThreshold,
                },
              });
            }
          }
        }
      }
    } catch (e) {
      logger.error("onListingCreated error", e);
    }
  }
);

/**
 * conversations/{conversationId} created
 * - daily.newConversations++
 * - global.totalConversations++
 */
export const onConversationCreated = onDocumentCreated(
  "conversations/{conversationId}",
  async (event) => {
    try {
      const snap = event.data;
      if (!snap) return;

      const db = admin.firestore();
      const data = snap.data() as any;

      const createdAt =
        data?.createdAt ??
        admin.firestore.Timestamp.fromDate(new Date(event.time));
      const dateKey = toDateKeyTR(createdAt);

      await Promise.all([
        incDailyStat(dateKey, { newConversations: 1 }),
        incGlobalStat({ totalConversations: 1 }),
      ]);

      // participants -> users.conversationsCount++
      const participants = Array.isArray(data?.participants) ? data.participants : [];

      for (const uid of participants) {
        if (typeof uid === "string" && uid) {
          await db.collection("users").doc(uid).set(
            {
              conversationsCount: admin.firestore.FieldValue.increment(1),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      }
    } catch (e) {
      logger.error("onConversationCreated error", e);
    }
  }
);

/**
 * conversations/{conversationId}/messages/{messageId} created
 * - daily.newMessages++
 * - global.totalMessages++
 * - autoFlags (bannedWordsMessage)
 */
export const onMessageCreated = onDocumentCreated(
  "conversations/{conversationId}/messages/{messageId}",
  async (event) => {
    try {
      const conversationId = event.params.conversationId;
      const messageId = event.params.messageId;

      const snap = event.data;
      if (!snap) return;

      const db = admin.firestore();
      const data = snap.data() as any;

      const createdAt =
        data?.createdAt ??
        admin.firestore.Timestamp.fromDate(new Date(event.time));
      const dateKey = toDateKeyTR(createdAt);

      await Promise.all([
        incDailyStat(dateKey, { newMessages: 1 }),
        incGlobalStat({ totalMessages: 1 }),
      ]);

      const policy = await getAdminPolicy();

      const text = typeof data?.text === "string" ? data.text : "";
      const hit = includesBannedWord(text, policy.bannedWords);

      if (hit) {
        await upsertAutoFlag({
          flagId: `bannedWordsMessage_msg_${conversationId}_${messageId}`,
          type: "bannedWordsMessage",
          severity: "medium",
          targetType: "message",
          targetId: messageId,
          targetPath: `conversations/${conversationId}/messages/${messageId}`,
          sampleText: String(text).slice(0, 140),
          meta: { word: hit, conversationId, messageId },
        });

        await db.collection("conversations").doc(conversationId).set(
          {
            riskFlags: admin.firestore.FieldValue.arrayUnion("bannedWords"),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    } catch (e) {
      logger.error("onMessageCreated error", e);
    }
  }
);

/**
 * reports/{reportId} created
 * - daily.reportsOpened++
 * - global.totalReports++
 */
export const onReportCreated = onDocumentCreated(
  "reports/{reportId}",
  async (event) => {
    try {
      const snap = event.data;
      if (!snap) return;

      const data = snap.data() as any;

      const createdAt =
        data?.createdAt ??
        admin.firestore.Timestamp.fromDate(new Date(event.time));
      const dateKey = toDateKeyTR(createdAt);

      await Promise.all([
        incDailyStat(dateKey, { reportsOpened: 1 }),
        incGlobalStat({ totalReports: 1 }),
      ]);
    } catch (e) {
      logger.error("onReportCreated error", e);
    }
  }
);

/**
 * reports/{reportId} updated
 * open -> resolved => daily.reportsResolved++
 */
export const onReportUpdated = onDocumentUpdated(
  "reports/{reportId}",
  async (event) => {
    try {
      const before = event.data?.before.data() as any;
      const after = event.data?.after.data() as any;

      if (!before || !after) return;

      const beforeStatus = before.status;
      const afterStatus = after.status;

      if (beforeStatus !== "resolved" && afterStatus === "resolved") {
        const updatedAt =
          after.resolvedAt ??
          after.updatedAt ??
          admin.firestore.Timestamp.fromDate(new Date(event.time));

        const dateKey = toDateKeyTR(updatedAt);
        await incDailyStat(dateKey, { reportsResolved: 1 });
      }
    } catch (e) {
      logger.error("onReportUpdated error", e);
    }
  }
);

/**
 * ✅ autoFlags/{flagId} created
 * - daily.autoFlagsOpened++
 * - global.totalAutoFlags++
 */
export const onAutoFlagCreated = onDocumentCreated(
  "autoFlags/{flagId}",
  async (event) => {
    try {
      const snap = event.data;
      if (!snap) return;

      const data = snap.data() as any;

      const createdAt =
        data?.createdAt ??
        admin.firestore.Timestamp.fromDate(new Date(event.time));
      const dateKey = toDateKeyTR(createdAt);

      await Promise.all([
        incDailyStat(dateKey, { autoFlagsOpened: 1 }),
        incGlobalStat({ totalAutoFlags: 1 }),
      ]);
    } catch (e) {
      logger.error("onAutoFlagCreated error", e);
    }
  }
);

/**
 * ✅ autoFlags/{flagId} updated
 * open/investigating -> resolved => daily.autoFlagsResolved++
 */
export const onAutoFlagUpdated = onDocumentUpdated(
  "autoFlags/{flagId}",
  async (event) => {
    try {
      const before = event.data?.before.data() as any;
      const after = event.data?.after.data() as any;

      if (!before || !after) return;

      const beforeStatus = before.status;
      const afterStatus = after.status;

      if (beforeStatus !== "resolved" && afterStatus === "resolved") {
        const updatedAt =
          after.resolvedAt ??
          after.updatedAt ??
          admin.firestore.Timestamp.fromDate(new Date(event.time));

        const dateKey = toDateKeyTR(updatedAt);
        await incDailyStat(dateKey, { autoFlagsResolved: 1 });
      }
    } catch (e) {
      logger.error("onAutoFlagUpdated error", e);
    }
  }
);
