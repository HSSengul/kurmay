import { setGlobalOptions } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

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

function getTRDayRangeMs(dateKey: string) {
  const startMs = Date.parse(`${dateKey}T00:00:00+03:00`);
  const safeStart = Number.isFinite(startMs)
    ? startMs
    : Date.now();
  return {
    startMs: safeStart,
    endMs: safeStart + 24 * 60 * 60 * 1000,
  };
}

async function countQuery(q: FirebaseFirestore.Query): Promise<number> {
  const snap = await q.count().get();
  const v = snap.data()?.count;
  return typeof v === "number" ? v : 0;
}

async function safeCount(label: string, q: FirebaseFirestore.Query): Promise<number> {
  try {
    return await countQuery(q);
  } catch (e) {
    logger.error("recomputeAdminStatsNow count failed", { label, error: e });
    return 0;
  }
}

/**
 * ✅ Callable: Admin stats recompute (global + today)
 */
export const recomputeAdminStatsNow = onCall(
  { cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Giriş gerekli.");

    const ok = await isAdminUid(uid);
    if (!ok) throw new HttpsError("permission-denied", "Sadece admin.");

    try {
      const db = admin.firestore();
      const dateKey = toDateKeyTR(new Date());
      const { startMs, endMs } = getTRDayRangeMs(dateKey);
      const startTs = admin.firestore.Timestamp.fromMillis(startMs);
      const endTs = admin.firestore.Timestamp.fromMillis(endMs);

      // global totals
      const [
        totalUsers,
        totalListings,
        totalConversations,
        totalMessages,
        totalReports,
        totalAutoFlags,
      ] = await Promise.all([
        safeCount("totalUsers", db.collection("users")),
        safeCount("totalListings", db.collection("listings")),
        safeCount("totalConversations", db.collection("conversations")),
        safeCount("totalMessages", db.collectionGroup("messages")),
        safeCount("totalReports", db.collection("reports")),
        safeCount("totalAutoFlags", db.collection("autoFlags")),
      ]);

      // today stats
      const [
        newUsers,
        newListings,
        newConversations,
        newMessages,
        reportsOpened,
        reportsResolved,
        autoFlagsOpened,
      ] = await Promise.all([
        safeCount(
          "newUsers",
          db
            .collection("users")
            .where("createdAt", ">=", startTs)
            .where("createdAt", "<", endTs)
        ),
        safeCount(
          "newListings",
          db
            .collection("listings")
            .where("createdAt", ">=", startTs)
            .where("createdAt", "<", endTs)
        ),
        safeCount(
          "newConversations",
          db
            .collection("conversations")
            .where("createdAt", ">=", startTs)
            .where("createdAt", "<", endTs)
        ),
        safeCount(
          "newMessages",
          db
            .collectionGroup("messages")
            .where("createdAt", ">=", startTs)
            .where("createdAt", "<", endTs)
        ),
        safeCount(
          "reportsOpened",
          db
            .collection("reports")
            .where("createdAt", ">=", startTs)
            .where("createdAt", "<", endTs)
        ),
        // resolvedAt set olduğunda zaten resolved sayıyoruz -> composite index gerekmesin
        safeCount(
          "reportsResolved",
          db
            .collection("reports")
            .where("resolvedAt", ">=", startTs)
            .where("resolvedAt", "<", endTs)
        ),
        safeCount(
          "autoFlagsOpened",
          db
            .collection("autoFlags")
            .where("createdAt", ">=", startTs)
            .where("createdAt", "<", endTs)
        ),
      ]);

      await Promise.all([
        db.collection("adminStats").doc("global").set(
          {
            totalUsers,
            totalListings,
            totalConversations,
            totalMessages,
            totalReports,
            totalAutoFlags,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        ),
        db.collection("adminStatsDaily").doc(dateKey).set(
          {
            dateKey,
            newUsers,
            newListings,
            newConversations,
            newMessages,
            reportsOpened,
            reportsResolved,
            autoFlagsOpened,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        ),
      ]);

      return {
        ok: true,
        dateKey,
        totals: {
          totalUsers,
          totalListings,
          totalConversations,
          totalMessages,
          totalReports,
          totalAutoFlags,
        },
        today: {
          newUsers,
          newListings,
          newConversations,
          newMessages,
          reportsOpened,
          reportsResolved,
          autoFlagsOpened,
        },
      };
    } catch (e) {
      logger.error("recomputeAdminStatsNow fatal", e);
      return { ok: false, error: "failed" };
    }
  }
);

function getUnreadForRole(data: any, role: "buyer" | "seller"): number {
  if (!data) return 0;
  if (data?.deletedFor?.[role]) return 0;
  const v = data?.unread?.[role];
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
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

function foldTRForSchema(input: string) {
  return normalizeLowerTR(input || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\u0131/g, "i")
    .trim();
}

function buildSchemaFieldsByCategory(categoryId: string, nameLower: string): SchemaField[] {
  const id = foldTRForSchema(categoryId || "").replace(/_/g, "-");
  const n = foldTRForSchema(nameLower || "");
  const has = (...parts: string[]) =>
    parts.some((p) => n.includes(foldTRForSchema(p)));
  const hasId = (...parts: string[]) =>
    parts.some((p) => id.includes(foldTRForSchema(p).replace(/\s+/g, "-")));

  const boardgame: SchemaField[] = [
    { key: "gameName", label: "Oyun adi", type: "text", sectionId: "details" },
    { key: "minPlayers", label: "Minimum oyuncu", type: "number", required: true, sectionId: "details", min: 1, max: 50 },
    { key: "maxPlayers", label: "Maksimum oyuncu", type: "number", required: true, sectionId: "details", min: 1, max: 50 },
    { key: "minPlaytime", label: "Minimum sure (dk)", type: "number", sectionId: "details", min: 1, max: 1000 },
    { key: "maxPlaytime", label: "Maksimum sure (dk)", type: "number", sectionId: "details", min: 1, max: 1000 },
    {
      key: "language",
      label: "Dil",
      type: "select",
      sectionId: "details",
      options: [
        { value: "TR", label: "Turkce" },
        { value: "EN", label: "Ingilizce" },
        { value: "OTHER", label: "Diger" },
      ],
    },
    { key: "completeContent", label: "Icerik tam mi?", type: "boolean", required: true, sectionId: "condition" },
    { key: "sleeved", label: "Sleeve kullanildi mi?", type: "boolean", sectionId: "condition" },
  ];

  const cardgame: SchemaField[] = [
    { key: "gameName", label: "Oyun adi", type: "text", required: true, sectionId: "details" },
    {
      key: "playerRange",
      label: "Oyuncu araligi",
      type: "select",
      sectionId: "details",
      options: [
        { value: "1-2", label: "1-2" },
        { value: "2-4", label: "2-4" },
        { value: "2-6", label: "2-6" },
        { value: "4+", label: "4+" },
        { value: "variable", label: "Degisken" },
      ],
    },
    {
      key: "language",
      label: "Dil",
      type: "select",
      sectionId: "details",
      options: [
        { value: "TR", label: "Turkce" },
        { value: "EN", label: "Ingilizce" },
        { value: "OTHER", label: "Diger" },
      ],
    },
    { key: "completeContent", label: "Icerik tam mi?", type: "boolean", required: true, sectionId: "condition" },
  ];

  const tcg: SchemaField[] = [
    {
      key: "itemType",
      label: "Urun tipi",
      type: "select",
      required: true,
      sectionId: "details",
      options: [
        { value: "single", label: "Tekli Kart" },
        { value: "deck", label: "Deck / Structure Deck" },
        { value: "booster", label: "Booster / Pack" },
        { value: "box", label: "Booster Box" },
        { value: "collection", label: "Koleksiyon / Lot" },
        { value: "accessory", label: "Aksesuar" },
      ],
    },
    {
      key: "tcgName",
      label: "TCG",
      type: "select",
      sectionId: "details",
      options: [
        { value: "pokemon", label: "Pokemon" },
        { value: "yugioh", label: "Yu-Gi-Oh!" },
        { value: "mtg", label: "Magic: The Gathering" },
        { value: "onepiece", label: "One Piece" },
        { value: "lorcana", label: "Lorcana" },
        { value: "other", label: "Diger" },
      ],
    },
    { key: "setName", label: "Set / Seri", type: "text", sectionId: "details" },
    {
      key: "cardCondition",
      label: "Kart kondisyonu",
      type: "select",
      sectionId: "condition",
      options: [
        { value: "mint", label: "Mint" },
        { value: "nearMint", label: "Near Mint" },
        { value: "excellent", label: "Excellent" },
        { value: "good", label: "Good" },
        { value: "played", label: "Played" },
        { value: "poor", label: "Poor" },
      ],
    },
    { key: "graded", label: "Graded mi?", type: "boolean", sectionId: "condition" },
    {
      key: "accessoryType",
      label: "Aksesuar tipi",
      type: "select",
      sectionId: "details",
      options: [
        { value: "sleeve", label: "Sleeve" },
        { value: "binder", label: "Binder" },
        { value: "deckbox", label: "Deck Box" },
        { value: "playmat", label: "Playmat" },
        { value: "token", label: "Token/Zar" },
        { value: "other", label: "Diger" },
      ],
    },
  ];

  const consoleHardware: SchemaField[] = [
    { key: "consoleModel", label: "Model / Surum", type: "text", required: true, sectionId: "details" },
    {
      key: "storage",
      label: "Depolama",
      type: "select",
      sectionId: "details",
      options: [
        { value: "32GB", label: "32GB" },
        { value: "64GB", label: "64GB" },
        { value: "128GB", label: "128GB" },
        { value: "256GB", label: "256GB" },
        { value: "512GB", label: "512GB" },
        { value: "1TB", label: "1TB" },
        { value: "2TB", label: "2TB" },
        { value: "4TB", label: "4TB" },
        { value: "unknown", label: "Yok / Belirsiz" },
      ],
    },
    { key: "modded", label: "Modlu mu?", type: "boolean", sectionId: "condition" },
    { key: "box", label: "Kutu var mi?", type: "boolean", sectionId: "condition" },
    { key: "controllerCount", label: "Kumanda sayisi", type: "number", sectionId: "details", min: 0, max: 10 },
    { key: "accessories", label: "Aksesuarlar", type: "text", sectionId: "details" },
    { key: "purchaseYear", label: "Satin alma yili", type: "number", sectionId: "details", min: 1980, max: 2100 },
    {
      key: "warrantyStatus",
      label: "Garanti durumu",
      type: "select",
      sectionId: "condition",
      options: [
        { value: "active", label: "Devam ediyor" },
        { value: "expired", label: "Bitmis" },
        { value: "unknown", label: "Bilinmiyor" },
      ],
    },
    {
      key: "usageLevel",
      label: "Kullanim yogunlugu",
      type: "select",
      sectionId: "condition",
      options: [
        { value: "low", label: "Az" },
        { value: "mid", label: "Orta" },
        { value: "high", label: "Yogun" },
      ],
    },
    {
      key: "batteryHealth",
      label: "Pil sagligi",
      type: "select",
      sectionId: "condition",
      options: [
        { value: "veryGood", label: "Cok iyi" },
        { value: "good", label: "Iyi" },
        { value: "mid", label: "Orta" },
        { value: "low", label: "Zayif" },
        { value: "unknown", label: "Bilinmiyor" },
      ],
    },
    {
      key: "screenCondition",
      label: "Ekran durumu",
      type: "select",
      sectionId: "condition",
      options: [
        { value: "clean", label: "Ciziksiz" },
        { value: "light", label: "Hafif cizik" },
        { value: "heavy", label: "Belirgin cizik" },
        { value: "broken", label: "Kirik" },
        { value: "unknown", label: "Bilinmiyor" },
      ],
    },
    {
      key: "stickDrift",
      label: "Stick drift var mi?",
      type: "select",
      sectionId: "condition",
      options: [
        { value: "none", label: "Yok" },
        { value: "yes", label: "Var" },
        { value: "unknown", label: "Bilinmiyor" },
      ],
    },
  ];

  const consoleGame: SchemaField[] = [
    {
      key: "platform",
      label: "Platform",
      type: "select",
      required: true,
      sectionId: "details",
      options: [
        { value: "ps5", label: "PS5" },
        { value: "ps4", label: "PS4" },
        { value: "xboxSeries", label: "Xbox Series" },
        { value: "xboxOne", label: "Xbox One" },
        { value: "switch", label: "Switch" },
        { value: "pc", label: "PC" },
        { value: "other", label: "Diger" },
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
        { value: "cartridge", label: "Kartus" },
        { value: "digital", label: "Dijital Kod" },
        { value: "dlc", label: "DLC / Season Pass" },
        { value: "collector", label: "Koleksiyon / Steelbook" },
      ],
    },
    {
      key: "region",
      label: "Bolge",
      type: "select",
      sectionId: "details",
      options: [
        { value: "PAL", label: "PAL" },
        { value: "NTSC-U", label: "NTSC-U" },
        { value: "NTSC-J", label: "NTSC-J" },
        { value: "unknown", label: "Bilinmiyor" },
      ],
    },
    {
      key: "discCondition",
      label: "Disk/Kartus kondisyonu",
      type: "select",
      sectionId: "condition",
      options: [
        { value: "clean", label: "Ciziksiz" },
        { value: "light", label: "Hafif cizik" },
        { value: "heavy", label: "Belirgin cizik" },
        { value: "unknown", label: "Bilinmiyor" },
      ],
    },
    { key: "box", label: "Kutu var mi?", type: "boolean", sectionId: "condition" },
  ];

  const retroMixed: SchemaField[] = [
    {
      key: "itemType",
      label: "Urun tipi",
      type: "select",
      required: true,
      sectionId: "details",
      options: [
        { value: "console", label: "Retro Konsol" },
        { value: "game", label: "Retro Oyun" },
        { value: "part", label: "Aksesuar / Parca" },
        { value: "other", label: "Diger" },
      ],
    },
    {
      key: "platform",
      label: "Platform",
      type: "select",
      sectionId: "details",
      options: [
        { value: "atari", label: "Atari" },
        { value: "nes", label: "NES" },
        { value: "snes", label: "SNES" },
        { value: "megadrive", label: "Sega Mega Drive" },
        { value: "ps1", label: "PS1" },
        { value: "ps2", label: "PS2" },
        { value: "n64", label: "Nintendo 64" },
        { value: "other", label: "Diger" },
      ],
    },
    {
      key: "format",
      label: "Format",
      type: "select",
      sectionId: "details",
      options: [
        { value: "cartridge", label: "Kartus" },
        { value: "disc", label: "Disk" },
        { value: "cassette", label: "Kaset" },
        { value: "digital", label: "Dijital Kod" },
        { value: "other", label: "Diger" },
      ],
    },
    { key: "works", label: "Calisiyor mu?", type: "boolean", sectionId: "condition" },
    { key: "modded", label: "Modlu mu?", type: "boolean", sectionId: "condition" },
    { key: "box", label: "Kutu var mi?", type: "boolean", sectionId: "condition" },
  ];

  const figure: SchemaField[] = [
    {
      key: "figureType",
      label: "Figur tipi",
      type: "select",
      required: true,
      sectionId: "details",
      options: [
        { value: "action", label: "Action Figure" },
        { value: "statue", label: "Statue/Bust" },
        { value: "funko", label: "Funko" },
        { value: "modelKit", label: "Model Kit" },
        { value: "other", label: "Diger" },
      ],
    },
    { key: "brand", label: "Marka", type: "text", sectionId: "details" },
    { key: "series", label: "Seri / Evren", type: "text", sectionId: "details" },
    { key: "scale", label: "Olcek", type: "text", sectionId: "details" },
    { key: "box", label: "Kutu var mi?", type: "boolean", sectionId: "condition" },
  ];

  const miniatureWargame: SchemaField[] = [
    { key: "system", label: "Sistem / Oyun", type: "text", sectionId: "details" },
    { key: "faction", label: "Faction", type: "text", sectionId: "details" },
    { key: "scale", label: "Olcek", type: "text", sectionId: "details" },
    { key: "painted", label: "Boyali mi?", type: "boolean", sectionId: "condition" },
    { key: "assembled", label: "Montajli mi?", type: "boolean", sectionId: "condition" },
  ];

  const rpg: SchemaField[] = [
    { key: "system", label: "Sistem", type: "text", required: true, sectionId: "details" },
    {
      key: "productType",
      label: "Urun tipi",
      type: "select",
      required: true,
      sectionId: "details",
      options: [
        { value: "core", label: "Core Rulebook" },
        { value: "adventure", label: "Adventure Module" },
        { value: "supplement", label: "Supplement" },
        { value: "starter", label: "Starter Set" },
        { value: "dice", label: "Dice/Accessory" },
        { value: "other", label: "Diger" },
      ],
    },
    { key: "edition", label: "Edition / Versiyon", type: "text", sectionId: "details" },
    { key: "hardcover", label: "Ciltli mi?", type: "boolean", sectionId: "condition" },
  ];

  const bookGuide: SchemaField[] = [
    {
      key: "bookType",
      label: "Urun tipi",
      type: "select",
      required: true,
      sectionId: "details",
      options: [
        { value: "guide", label: "Strateji Rehberi" },
        { value: "artbook", label: "Artbook" },
        { value: "lore", label: "Lore Kitabi" },
        { value: "comic", label: "Roman/Comic" },
        { value: "other", label: "Diger" },
      ],
    },
    { key: "title", label: "Kitap adi", type: "text", sectionId: "details" },
    {
      key: "language",
      label: "Dil",
      type: "select",
      sectionId: "details",
      options: [
        { value: "TR", label: "Turkce" },
        { value: "EN", label: "Ingilizce" },
        { value: "OTHER", label: "Diger" },
      ],
    },
    { key: "coverType", label: "Kapak tipi", type: "text", sectionId: "details" },
  ];

  const puzzle: SchemaField[] = [
    {
      key: "itemType",
      label: "Urun tipi",
      type: "select",
      required: true,
      sectionId: "details",
      options: [
        { value: "puzzle", label: "Puzzle" },
        { value: "3d", label: "3D Puzzle" },
        { value: "mind", label: "Zeka Oyunu" },
        { value: "rubik", label: "Rubik/Twist" },
        { value: "other", label: "Diger" },
      ],
    },
    { key: "pieceCount", label: "Parca sayisi", type: "number", sectionId: "details", min: 10, max: 50000 },
    { key: "completeContent", label: "Eksiksiz mi?", type: "boolean", required: true, sectionId: "condition" },
  ];

  const accessory: SchemaField[] = [
    {
      key: "accessoryType",
      label: "Aksesuar tipi",
      type: "select",
      required: true,
      sectionId: "details",
      options: [
        { value: "controller", label: "Controller/Gamepad" },
        { value: "cable", label: "Kablolar/Adaptor" },
        { value: "dock", label: "Dock/Sarj" },
        { value: "audio", label: "Headset/Mikrofon" },
        { value: "storage", label: "Depolama" },
        { value: "other", label: "Diger" },
      ],
    },
    { key: "compatibility", label: "Uyumluluk", type: "text", sectionId: "details" },
    { key: "original", label: "Orijinal mi?", type: "boolean", sectionId: "condition" },
    { key: "warranty", label: "Garantili mi?", type: "boolean", sectionId: "condition" },
  ];

  const collectible: SchemaField[] = [
    {
      key: "itemType",
      label: "Urun tipi",
      type: "select",
      required: true,
      sectionId: "details",
      options: [
        { value: "figure", label: "Figur" },
        { value: "poster", label: "Poster" },
        { value: "steelbook", label: "Steelbook" },
        { value: "card", label: "Kart/Koleksiyon" },
        { value: "decor", label: "Dekor" },
        { value: "other", label: "Diger" },
      ],
    },
    { key: "franchise", label: "Seri / Evren", type: "text", sectionId: "details" },
    { key: "brand", label: "Marka", type: "text", sectionId: "details" },
    { key: "material", label: "Malzeme", type: "text", sectionId: "details" },
    { key: "box", label: "Kutu var mi?", type: "boolean", sectionId: "condition" },
  ];

  const legoHobby: SchemaField[] = [
    {
      key: "itemType",
      label: "Urun tipi",
      type: "select",
      required: true,
      sectionId: "details",
      options: [
        { value: "legoSet", label: "LEGO Set" },
        { value: "minifig", label: "MiniFig / Parca" },
        { value: "modelKit", label: "Maket / Model Kit" },
        { value: "puzzle", label: "Puzzle" },
        { value: "hobby", label: "Boyama / Hobi Ekipmani" },
        { value: "other", label: "Diger" },
      ],
    },
    { key: "themeSeries", label: "Tema / Seri", type: "text", sectionId: "details" },
    {
      key: "pieceCount",
      label: "Parca sayisi",
      type: "number",
      sectionId: "details",
      min: 1,
      max: 50000,
    },
    { key: "completeContent", label: "Icerik tam mi?", type: "boolean", sectionId: "condition" },
    { key: "box", label: "Kutu var mi?", type: "boolean", sectionId: "condition" },
    { key: "original", label: "Orijinal mi?", type: "boolean", sectionId: "condition" },
  ];

  const tech: SchemaField[] = [
    {
      key: "itemType",
      label: "Urun tipi",
      type: "select",
      required: true,
      sectionId: "details",
      options: [
        { value: "retroEmulator", label: "Retro Emulator Cihazi" },
        { value: "miniPc", label: "Mini PC" },
        { value: "streamGear", label: "Streaming Ekipmani" },
        { value: "modGear", label: "Mod Ekipmani" },
        { value: "storageCard", label: "Depolama / Kart" },
        { value: "other", label: "Diger" },
      ],
    },
    {
      key: "platform",
      label: "Platform / Uyumluluk",
      type: "text",
      sectionId: "details",
    },
    {
      key: "storage",
      label: "Depolama",
      type: "select",
      sectionId: "details",
      options: [
        { value: "64GB", label: "64GB" },
        { value: "128GB", label: "128GB" },
        { value: "256GB", label: "256GB" },
        { value: "512GB", label: "512GB" },
        { value: "1TB", label: "1TB" },
        { value: "2TB", label: "2TB" },
        { value: "unknown", label: "Yok / Belirsiz" },
      ],
    },
    { key: "box", label: "Kutu var mi?", type: "boolean", sectionId: "condition" },
    { key: "warranty", label: "Garantili mi?", type: "boolean", sectionId: "condition" },
    { key: "accessories", label: "Aksesuar / Ek parcalar", type: "text", sectionId: "details" },
  ];

  const vr: SchemaField[] = [
    {
      key: "itemType",
      label: "Urun tipi",
      type: "select",
      required: true,
      sectionId: "details",
      options: [
        { value: "headset", label: "VR Baslik" },
        { value: "controller", label: "Controller" },
        { value: "sensor", label: "Sensor/Base Station" },
        { value: "accessory", label: "Aksesuar" },
        { value: "other", label: "Diger" },
      ],
    },
    {
      key: "platform",
      label: "Platform",
      type: "select",
      sectionId: "details",
      options: [
        { value: "ps5", label: "PS5" },
        { value: "ps4", label: "PS4" },
        { value: "pc", label: "PC" },
        { value: "standalone", label: "Standalone" },
        { value: "other", label: "Diger" },
      ],
    },
    { key: "lensCondition", label: "Lens durumu", type: "text", sectionId: "condition" },
    { key: "box", label: "Kutu var mi?", type: "boolean", sectionId: "condition" },
  ];

  const fallback: SchemaField[] = [
    {
      key: "itemType",
      label: "Urun tipi",
      type: "select",
      required: true,
      sectionId: "details",
      options: [
        { value: "general", label: "Genel Urun" },
        { value: "accessory", label: "Aksesuar" },
        { value: "collectible", label: "Koleksiyon" },
        { value: "other", label: "Diger" },
      ],
    },
    { key: "brand", label: "Marka", type: "text", sectionId: "details" },
    { key: "compatibility", label: "Uyumluluk", type: "text", sectionId: "details" },
    { key: "material", label: "Malzeme", type: "text", sectionId: "details" },
    { key: "box", label: "Kutu var mi?", type: "boolean", sectionId: "condition" },
  ];

  // Öncelik: id bazlı eşleştirme
  if (hasId("kutu-oyunlari")) return boardgame;
  if (hasId("konsol-oyunlari")) return consoleGame;
  if (hasId("konsollar", "el-konsollari")) return consoleHardware;
  if (hasId("tcg", "koleksiyon-kart")) return tcg;
  if (hasId("figur")) return figure;
  if (hasId("miniature", "wargame")) return miniatureWargame;
  if (hasId("masaustu-rpg", "rpg")) return rpg;
  if (hasId("manga-cizgi-roman", "rehber", "kitap")) return bookGuide;
  if (hasId("lego-hobi")) return legoHobby;
  if (hasId("dekor-poster", "koleksiyon-urun", "koleksiyon")) return collectible;
  if (hasId("teknoloji")) return tech;
  if (hasId("ekipman", "aksesuar")) return accessory;
  if (hasId("puzzle", "zeka")) return puzzle;
  if (hasId("vr", "sanal-gerceklik")) return vr;
  if (hasId("diger")) return fallback;

  // Geriye uyumluluk: isim bazlı eşleştirme
  if (has("kutu oyun")) return boardgame;
  if (has("kart oyun")) return cardgame;

  if (has("koleksiyon kart", "tcg")) return tcg;
  if (has("retro oyun", "retro konsol")) return retroMixed;
  if (has("konsol oyun")) return consoleGame;

  if (has("hobi ekipman", "ekipman", "oyun aksesuar", "aksesuar")) {
    return accessory;
  }
  if (has("teknoloji", "retro emul", "mini pc", "stream")) return tech;

  if (has("el konsol", "konsollar", "konsol")) return consoleHardware;

  if (has("vr", "sanal gerceklik")) return vr;

  if (has("figur", "fig")) return figure;
  if (has("miniature", "wargame")) return miniatureWargame;

  if (has("masaustu rpg", "rpg")) return rpg;
  if (has("rehber", "kitap", "manga", "cizgi roman", "light novel", "artbook")) {
    return bookGuide;
  }

  if (has("puzzle", "zeka")) return puzzle;
  if (has("lego", "minifig", "gunpla")) return legoHobby;
  if (has("koleksiyon urun", "koleksiyon", "dekor", "poster")) return collectible;

  return fallback;
}

function buildListingSchemaDoc(
  categoryId: string,
  categoryName: string,
  nameLower: string
): ListingSchemaDoc {
  return {
    schemaVersion: 1,
    categoryName: safeString(categoryName, "Kategori"),
    isActive: true,
    sections: [
      { id: "details", title: "Detaylar", order: 1 },
      { id: "condition", title: "Durum", order: 2 },
    ],
    fields: buildSchemaFieldsByCategory(categoryId, nameLower),
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
    batch.set(schemaRef, buildListingSchemaDoc(categoryId, name, nameLower), { merge: false });

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

      await ref.set(buildListingSchemaDoc(categoryId, name, nameLower), { merge: false });
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
        unreadCount: admin.firestore.FieldValue.increment(0),
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
 * conversations/{conversationId} written
 * - users/{uid}.unreadCount aggregate delta update
 */
export const onConversationUnreadAggregate = onDocumentWritten(
  "conversations/{conversationId}",
  async (event) => {
    try {
      const before = event.data?.before.data() as any;
      const after = event.data?.after.data() as any;

      if (!before && !after) return;

      const db = admin.firestore();

      const prevBuyerId = before?.buyerId ?? null;
      const nextBuyerId = after?.buyerId ?? null;
      const prevSellerId = before?.sellerId ?? null;
      const nextSellerId = after?.sellerId ?? null;

      const prevBuyerUnread = getUnreadForRole(before, "buyer");
      const nextBuyerUnread = getUnreadForRole(after, "buyer");
      const prevSellerUnread = getUnreadForRole(before, "seller");
      const nextSellerUnread = getUnreadForRole(after, "seller");

      const updates: Promise<any>[] = [];

      const bump = (uid: string | null, delta: number) => {
        if (!uid || !delta) return;
        updates.push(
          db.collection("users").doc(uid).set(
            {
              unreadCount: admin.firestore.FieldValue.increment(delta),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          )
        );
      };

      if (prevBuyerId && prevBuyerId !== nextBuyerId) {
        bump(prevBuyerId, -prevBuyerUnread);
      }
      if (nextBuyerId) {
        const delta =
          prevBuyerId === nextBuyerId
            ? nextBuyerUnread - prevBuyerUnread
            : nextBuyerUnread;
        bump(nextBuyerId, delta);
      }

      if (prevSellerId && prevSellerId !== nextSellerId) {
        bump(prevSellerId, -prevSellerUnread);
      }
      if (nextSellerId) {
        const delta =
          prevSellerId === nextSellerId
            ? nextSellerUnread - prevSellerUnread
            : nextSellerUnread;
        bump(nextSellerId, delta);
      }

      if (updates.length > 0) {
        await Promise.all(updates);
      }
    } catch (e) {
      logger.error("onConversationUnreadAggregate error", e);
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
