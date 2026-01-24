import { setGlobalOptions } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";

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
