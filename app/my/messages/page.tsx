"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  QuerySnapshot,
  DocumentData,
  updateDoc,
  Timestamp,
  limit,
} from "firebase/firestore";
import Link from "next/link";

/* =========================
   TYPES
========================= */

type Conversation = {
  id: string;
  buyerId: string;
  sellerId: string;
  participants?: string[];

  lastMessageAt?: any;
  lastMessage?: {
    text?: string;
    type: "text" | "image" | "system";
    senderId: string;
    createdAt?: any;
    imageUrl?: string;
  };

  unread?: {
    buyer?: number;
    seller?: number;
  };

  // ✅ sohbet temizleme (soft clear)
  clearedAt?: {
    buyer?: any | null;
    seller?: any | null;
  };

  // ✅ NEW: silme anındaki totalMessages snapshot (role bazlı)
  clearedCount?: {
    buyer?: number;
    seller?: number;
  };

  lastReadAt?: {
    buyer?: any;
    seller?: any;
  };

  typing?: {
    buyer?: boolean;
    seller?: boolean;
    updatedAt?: any;
    by?: string;
  };

  listingSnapshot?: {
    title?: string;
    price?: number;
    imageUrl?: string | null;
    brandName?: string;
    modelName?: string;
    city?: string;
    district?: string;
    condition?: string;
  };

  sellerSnapshot?: {
    displayName?: string;
    publicProfileId?: string;
    phoneVerified?: boolean;
    isPremium?: boolean;
    accountCreatedAt?: any;
    completed?: boolean;
  };

  buyerSnapshot?: {
    displayName?: string;
    phoneVerified?: boolean;
    isPremium?: boolean;
    accountCreatedAt?: any;
  };

  tags?: string[];

  totalMessages?: number;
};

/* =========================
   UI HELPERS
========================= */

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function safeString(v: any, fallback = ""): string {
  if (typeof v === "string") return v;
  if (v == null) return fallback;
  return String(v);
}

function safeNumber(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatTryPrice(v: number) {
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${Math.round(v)} ₺`;
  }
}

function getTimestampMillis(ts: any): number {
  if (!ts) return 0;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  return 0;
}

function timeAgoTR(ms: number) {
  if (!ms) return "";
  const now = Date.now();
  const diff = now - ms;
  if (diff < 0) return "az önce";

  const sec = Math.floor(diff / 1000);
  if (sec < 30) return "az önce";
  if (sec < 60) return `${sec} sn`;

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} dk`;

  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} sa`;

  const day = Math.floor(hour / 24);
  if (day < 7) return `${day} g`;

  try {
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

function getCounterpartyInfo(c: Conversation, userId: string) {
  const isBuyer = c.buyerId === userId;
  const name = isBuyer
    ? safeString(c.sellerSnapshot?.displayName, "Satıcı")
    : safeString(c.buyerSnapshot?.displayName, "Alıcı");

  const roleLabel = isBuyer ? "Alıcı" : "Satıcı";
  const counterpartyRoleLabel = isBuyer ? "Satıcı" : "Alıcı";

  const counterpartyCreatedAt = isBuyer
    ? c.sellerSnapshot?.accountCreatedAt
    : c.buyerSnapshot?.accountCreatedAt;

  return {
    isBuyer,
    counterpartyName: name,
    myRoleLabel: roleLabel,
    counterpartyRoleLabel,
    counterpartyCreatedAt,
  };
}

function getUnreadCount(c: Conversation, isBuyer: boolean) {
  const buyerUnread = safeNumber(c.unread?.buyer ?? 0, 0);
  const sellerUnread = safeNumber(c.unread?.seller ?? 0, 0);
  return isBuyer ? buyerUnread : sellerUnread;
}

function getLastMessagePreview(c: Conversation) {
  const lm = c.lastMessage;
  if (!lm) return "";
  if (lm.type === "image") return "📷 Fotoğraf";
  if (lm.type === "system") return "ℹ️ Bilgi";
  const t = safeString(lm.text, "");
  return t.length ? t : "Mesaj";
}

function getListingTitleLine(c: Conversation) {
  const brand = safeString(c.listingSnapshot?.brandName, "").trim();
  const model = safeString(c.listingSnapshot?.modelName, "").trim();
  if (brand || model) return `${brand} ${model}`.trim();
  const title = safeString(c.listingSnapshot?.title, "").trim();
  if (title) return title.slice(0, 60);
  return "İlan";
}

function getListingSubLine(c: Conversation) {
  const title = safeString(c.listingSnapshot?.title, "").trim();
  if (title) return title.slice(0, 90);
  return "";
}

function getListingLocationLine(c: Conversation) {
  const city = safeString(c.listingSnapshot?.city, "").trim();
  const district = safeString(c.listingSnapshot?.district, "").trim();
  if (!city && !district) return "";
  if (city && district) return `${district} / ${city}`;
  return city || district;
}

function getAccountAgeLabel(ts: any) {
  const ms = getTimestampMillis(ts);
  if (!ms) return null;
  const days = Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24));
  if (days < 7) return "🆕 Yeni";
  if (days < 30) return "Yeni üye";
  if (days < 180) return "6 aydan az";
  if (days < 365) return "6+ ay";
  return "1+ yıl";
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function getMyRole(c: Conversation, userId: string): "buyer" | "seller" {
  return c.buyerId === userId ? "buyer" : "seller";
}

function getVisibleMessageCount(c: Conversation, userId: string) {
  const role = getMyRole(c, userId);
  const total = safeNumber(c.totalMessages ?? 0, 0);
  const clearedCount = safeNumber(c.clearedCount?.[role] ?? 0, 0);
  return Math.max(0, total - clearedCount);
}

/* =========================
   SKELETON
========================= */

function SkeletonRow() {
  return (
    <div className="border rounded-lg p-3 sm:p-4 bg-white">
      <div className="flex gap-3">
        <div className="w-14 h-14 sm:w-16 sm:h-16 bg-gray-200 rounded animate-pulse" />
        <div className="flex-1">
          <div className="h-4 bg-gray-200 rounded w-2/3 animate-pulse" />
          <div className="mt-2 h-3 bg-gray-200 rounded w-1/3 animate-pulse" />
          <div className="mt-2 h-3 bg-gray-200 rounded w-5/6 animate-pulse" />
          <div className="mt-2 flex gap-2">
            <div className="h-5 bg-gray-200 rounded w-16 animate-pulse" />
            <div className="h-5 bg-gray-200 rounded w-20 animate-pulse" />
            <div className="h-5 bg-gray-200 rounded w-14 animate-pulse" />
          </div>
        </div>
        <div className="w-20 sm:w-28 flex flex-col items-end gap-2">
          <div className="h-4 bg-gray-200 rounded w-16 animate-pulse" />
          <div className="h-3 bg-gray-200 rounded w-12 animate-pulse" />
          <div className="h-6 bg-gray-200 rounded w-10 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

/* =========================
   SMALL UI: TOAST
========================= */

type Toast = { type: "success" | "error" | "info"; text: string } | null;

/* =========================
   PAGE
========================= */

export default function MessagesPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [sortMode, setSortMode] = useState<
    "lastMessageDesc" | "unreadFirst" | "priceHigh" | "priceLow"
  >("lastMessageDesc");

  const [pageSize, setPageSize] = useState(30);
  const [nowTick, setNowTick] = useState(Date.now());

  const [toast, setToast] = useState<Toast>(null);
  const toastTimerRef = useRef<any>(null);

  const [hasMore, setHasMore] = useState(false);

  const hideInFlightRef = useRef<Record<string, boolean>>({});
  const markReadInFlightRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  function showToast(t: Toast) {
    setToast(t);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  }

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setLoadError(null);

      if (!user) {
        setUserId(null);
        setConversations([]);
        setHasMore(false);
        setLoading(false);
        return;
      }

      setUserId(user.uid);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!userId) return;

    setLoading(true);
    setLoadError(null);

    const page = clampInt(pageSize, 10, 200);

    const q = query(
      collection(db, "conversations"),
      where("participants", "array-contains", userId),
      orderBy("lastMessageAt", "desc"),
      limit(page + 1)
    );

    const unsub = onSnapshot(
      q,
      (snap: QuerySnapshot<DocumentData>) => {
        const docs = snap.docs;
        const rawHasMore = docs.length > page;

        setHasMore(rawHasMore);

        const sliceDocs = rawHasMore ? docs.slice(0, page) : docs;

        const list: Conversation[] = [];

        sliceDocs.forEach((d) => {
          const data = d.data() as any;

          const myRole: "buyer" | "seller" = data.buyerId === userId ? "buyer" : "seller";
          const clearedMs = getTimestampMillis(data.clearedAt?.[myRole]);
          const lastMs = getTimestampMillis(data.lastMessageAt);

          // ✅ SADECE clearedAt
          // kullanıcı sildi -> clearedAt setlenir
          // lastMessageAt <= clearedAt ise inbox'ta görünmez
          if (clearedMs) {
            if (!lastMs) return;
            if (lastMs <= clearedMs) return;
          }

          // ✅ DRAFT FİLTRESİ: mesaj atılmamış sohbet inbox'a düşmesin
          const totalMessages = Number(data.totalMessages ?? 0);

          const hasLastMessage =
            !!data.lastMessage &&
            (data.lastMessage.type === "image" ||
              data.lastMessage.type === "system" ||
              (typeof data.lastMessage.text === "string" &&
                data.lastMessage.text.trim().length > 0));

          const isDraft = totalMessages <= 0 && !hasLastMessage;

          if (isDraft) {
            return;
          }

          list.push({ id: d.id, ...data });
        });

        setConversations(list);
        setLoading(false);
        setLoadError(null);
      },
      (err) => {
        console.error("MessagesPage onSnapshot error:", err);
        setLoading(false);
        setHasMore(false);
        setLoadError(err?.message || "Mesajlar yüklenemedi.");
      }
    );

    return () => unsub();
  }, [userId, pageSize]);

  const normalizedSearch = search.trim().toLowerCase();

  const computed = useMemo(() => {
    let filtered = conversations;

    if (normalizedSearch) {
      filtered = conversations.filter((c) => {
        const listing = getListingTitleLine(c).toLowerCase();
        const sub = getListingSubLine(c).toLowerCase();
        const last = getLastMessagePreview(c).toLowerCase();
        const loc = getListingLocationLine(c).toLowerCase();

        const cp =
          (c.buyerId === userId
            ? safeString(c.sellerSnapshot?.displayName, "")
            : safeString(c.buyerSnapshot?.displayName, "")
          ).toLowerCase();

        const priceStr = String(safeNumber(c.listingSnapshot?.price ?? 0, 0));
        const tagStr = Array.isArray(c.tags) ? c.tags.join(" ").toLowerCase() : "";

        return (
          listing.includes(normalizedSearch) ||
          sub.includes(normalizedSearch) ||
          last.includes(normalizedSearch) ||
          cp.includes(normalizedSearch) ||
          priceStr.includes(normalizedSearch) ||
          loc.includes(normalizedSearch) ||
          tagStr.includes(normalizedSearch)
        );
      });
    }

    if (onlyUnread && userId) {
      filtered = filtered.filter((c) => {
        const { isBuyer } = getCounterpartyInfo(c, userId);
        return getUnreadCount(c, isBuyer) > 0;
      });
    }

    const sorted = [...filtered];
    if (userId) {
      sorted.sort((a, b) => {
        const aLast = getTimestampMillis(a.lastMessageAt);
        const bLast = getTimestampMillis(b.lastMessageAt);

        const aPrice = safeNumber(a.listingSnapshot?.price ?? 0, 0);
        const bPrice = safeNumber(b.listingSnapshot?.price ?? 0, 0);

        const aUnread = getUnreadCount(a, getCounterpartyInfo(a, userId).isBuyer);
        const bUnread = getUnreadCount(b, getCounterpartyInfo(b, userId).isBuyer);

        if (sortMode === "unreadFirst") {
          if (bUnread !== aUnread) return bUnread - aUnread;
          return bLast - aLast;
        }

        if (sortMode === "priceHigh") {
          if (bPrice !== aPrice) return bPrice - aPrice;
          return bLast - aLast;
        }

        if (sortMode === "priceLow") {
          if (aPrice !== bPrice) return aPrice - bPrice;
          return bLast - aLast;
        }

        return bLast - aLast;
      });
    }

    let totalUnread = 0;
    if (userId) {
      for (const c of sorted) {
        const { isBuyer } = getCounterpartyInfo(c, userId);
        totalUnread += getUnreadCount(c, isBuyer);
      }
    }

    return { list: sorted, totalUnread };
  }, [conversations, normalizedSearch, onlyUnread, sortMode, userId, nowTick]);

  async function hideConversation(conversationId: string, c: Conversation) {
    if (!userId) return;

    if (hideInFlightRef.current[conversationId]) return;
    hideInFlightRef.current[conversationId] = true;

    try {
      const { isBuyer } = getCounterpartyInfo(c, userId);

      const ok = window.confirm("Bu sohbeti silmek istiyor musun?");
      if (!ok) return;

      const now = Timestamp.now();
      const convoRef = doc(db, "conversations", conversationId);

      // ✅ visible count fix için: silme anındaki totalMessages snapshot
      const currentTotal = safeNumber(c.totalMessages ?? 0, 0);

      // ✅ Silme = clearedAt + clearedCount (unread reset + lastReadAt)
      await updateDoc(convoRef, {
        ...(isBuyer
          ? {
              "clearedAt.buyer": now,
              "clearedCount.buyer": currentTotal,
              "unread.buyer": 0,
              "lastReadAt.buyer": now,
            }
          : {
              "clearedAt.seller": now,
              "clearedCount.seller": currentTotal,
              "unread.seller": 0,
              "lastReadAt.seller": now,
            }),
      });

      showToast({ type: "success", text: "Sohbet silindi." });
    } catch (err: any) {
      console.error("hideConversation error:", err);
      showToast({ type: "error", text: err?.message || "Sohbet silinemedi." });
    } finally {
      hideInFlightRef.current[conversationId] = false;
    }
  }

  async function markConversationAsRead(conversationId: string, c: Conversation) {
    if (!userId) return;

    if (markReadInFlightRef.current[conversationId]) return;
    markReadInFlightRef.current[conversationId] = true;

    try {
      const { isBuyer } = getCounterpartyInfo(c, userId);
      const unreadCount = getUnreadCount(c, isBuyer);
      if (unreadCount <= 0) {
        showToast({ type: "info", text: "Okunmamış mesaj yok." });
        return;
      }

      const now = Timestamp.now();
      const convoRef = doc(db, "conversations", conversationId);

      await updateDoc(convoRef, {
        ...(isBuyer
          ? { "unread.buyer": 0, "lastReadAt.buyer": now }
          : { "unread.seller": 0, "lastReadAt.seller": now }),
      });

      showToast({ type: "success", text: "Okundu olarak işaretlendi." });
    } catch (err: any) {
      console.error("markConversationAsRead error:", err);
      showToast({ type: "error", text: err?.message || "Okundu işaretlenemedi." });
    } finally {
      markReadInFlightRef.current[conversationId] = false;
    }
  }

  function computeOtherTyping(c: Conversation, userId: string) {
    const typing = c.typing;
    if (!typing) return false;

    const { isBuyer } = getCounterpartyInfo(c, userId);
    const otherRole: "buyer" | "seller" = isBuyer ? "seller" : "buyer";

    const updatedAtMs = getTimestampMillis(typing.updatedAt);
    if (!updatedAtMs) return false;

    const fresh = nowTick - updatedAtMs < 8000;
    if (!fresh) return false;

    return !!typing?.[otherRole];
  }

  if (!userId) {
    return (
      <div className="max-w-3xl mx-auto p-4">
        <div className="border rounded-lg p-4 bg-white">
          <div className="text-lg font-semibold">Mesajlar</div>
          <div className="mt-2 text-gray-600">Bu sayfayı görmek için giriş yapmalısın.</div>
        </div>
      </div>
    );
  }

  const list = computed.list;
  const totalUnread = computed.totalUnread;

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-4">
      {toast && (
        <div
          className={cx(
            "fixed z-50 left-1/2 -translate-x-1/2 top-4",
            "px-4 py-2 rounded-lg shadow border text-sm",
            toast.type === "success" && "bg-green-50 border-green-200 text-green-800",
            toast.type === "error" && "bg-red-50 border-red-200 text-red-800",
            toast.type === "info" && "bg-blue-50 border-blue-200 text-blue-800"
          )}
        >
          {toast.text}
        </div>
      )}

      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b -mx-3 sm:-mx-4 px-3 sm:px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold leading-tight">Mesajlar</h1>

            <div className="text-xs sm:text-sm text-gray-600">
              {loading ? (
                "Yükleniyor…"
              ) : (
                <>
                  {list.length} sohbet
                  {totalUnread > 0 ? (
                    <span className="ml-2 text-gray-900 font-medium">
                      • {totalUnread} okunmamış
                    </span>
                  ) : (
                    <span className="ml-2 text-gray-500">• okunmamış yok</span>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setNowTick(Date.now())}
              className="text-sm px-3 py-2 rounded-md border hover:bg-gray-50 active:bg-gray-100"
              title="Zaman bilgisini yenile"
            >
              <span aria-hidden>⟳</span>
              <span className="sr-only">Yenile</span>
            </button>

            <button
              type="button"
              onClick={() => showToast({ type: "info", text: "Mesajlar anlık güncelleniyor." })}
              className="text-sm px-3 py-2 rounded-md border hover:bg-gray-50 active:bg-gray-100"
              title="Bilgi"
            >
              <span aria-hidden>ℹ️</span>
              <span className="sr-only">Bilgi</span>
            </button>
          </div>
        </div>

        <div className="mt-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="İlan, kişi, mesaj, konum veya fiyat içinde ara…"
                className="w-full border rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200"
              />
              <div className="mt-1 text-[11px] text-gray-500">
                Örn: “Rolex”, “Kadıköy”, “125000”, “fotoğraf”
              </div>
            </div>

            <div className="flex gap-2 sm:flex-col sm:w-[220px]">
              <label className="flex items-center gap-2 border rounded-md px-3 py-2 text-sm bg-white">
                <input
                  type="checkbox"
                  checked={onlyUnread}
                  onChange={(e) => setOnlyUnread(e.target.checked)}
                />
                <span>Sadece okunmamış</span>
              </label>

              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as any)}
                className="border rounded-md px-3 py-2 text-sm bg-white"
                title="Sıralama"
              >
                <option value="lastMessageDesc">Son mesaja göre</option>
                <option value="unreadFirst">Okunmamış önce</option>
                <option value="priceHigh">Fiyat (yüksek)</option>
                <option value="priceLow">Fiyat (düşük)</option>
              </select>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-600" /> Okunmamış
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400" /> Okundu (💬 toplam mesaj)
            </span>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="mt-4 border rounded-lg p-4 bg-red-50">
          <div className="font-semibold text-red-700">Mesajlar yüklenemedi</div>
          <div className="mt-1 text-sm text-red-700">{loadError}</div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3 py-2 rounded-md bg-red-600 text-white text-sm hover:bg-red-700"
            >
              Yeniden dene
            </button>
            <button
              type="button"
              onClick={() => setLoadError(null)}
              className="px-3 py-2 rounded-md border text-sm hover:bg-white"
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="mt-4 space-y-3">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}

      {!loading && !loadError && list.length === 0 && (
        <div className="mt-6 border rounded-lg p-6 bg-white">
          <div className="text-lg font-semibold">Henüz mesajın yok</div>
          <div className="mt-2 text-gray-600">
            Bir ilana girip satıcıya mesaj atarak sohbet başlatabilirsin.
          </div>

          {search.trim().length > 0 && (
            <div className="mt-3 text-sm text-gray-500">
              Arama filtresi nedeniyle görünmüyor olabilir.{" "}
              <button type="button" className="underline" onClick={() => setSearch("")}>
                Aramayı temizle
              </button>
              .
            </div>
          )}

          {onlyUnread && (
            <div className="mt-3 text-sm text-gray-500">
              “Sadece okunmamış” açık olduğu için görünmüyor olabilir.{" "}
              <button type="button" className="underline" onClick={() => setOnlyUnread(false)}>
                Filtreyi kapat
              </button>
              .
            </div>
          )}
        </div>
      )}

      {!loading && !loadError && list.length > 0 && (
        <div className="mt-4 space-y-2">
          {list.map((c) => {
            const info = getCounterpartyInfo(c, userId);

            const unreadCount = getUnreadCount(c, info.isBuyer);
            const hasUnread = unreadCount > 0;

            const listingLine = getListingTitleLine(c);
            const subLine = getListingSubLine(c);

            const price = safeNumber(c.listingSnapshot?.price ?? 0, 0);
            const priceStr = formatTryPrice(price);

            const lastAtMs = getTimestampMillis(c.lastMessageAt);
            const timeAgo = timeAgoTR(lastAtMs);

            const imageUrl = c.listingSnapshot?.imageUrl
              ? safeString(c.listingSnapshot.imageUrl, "")
              : "";
            const locationLine = getListingLocationLine(c);

            const otherTyping = computeOtherTyping(c, userId);
            const lastMsg = otherTyping ? "✍️ Yazıyor…" : getLastMessagePreview(c);

            // ✅ visible count (silmeden önceki mesajlar düşülür)
            const totalMsgBubble = getVisibleMessageCount(c, userId);

            return (
              <Link
                key={c.id}
                href={`/my/messages/${c.id}`}
                className={cx(
                  "block border rounded-lg bg-white transition group",
                  hasUnread ? "border-blue-400 ring-1 ring-blue-200" : "border-gray-200",
                  "hover:bg-gray-50 active:bg-gray-100"
                )}
              >
                <div className="flex gap-3 p-3 sm:p-4">
                  <div className="relative w-14 h-14 sm:w-16 sm:h-16 shrink-0">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt="İlan görseli"
                        className={cx(
                          "w-full h-full object-cover rounded",
                          hasUnread && "ring-2 ring-blue-300"
                        )}
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className={cx(
                          "w-full h-full rounded bg-gray-200 flex items-center justify-center text-gray-500 text-xs",
                          hasUnread && "ring-2 ring-blue-300"
                        )}
                      >
                        Görsel
                      </div>
                    )}

                    {hasUnread && (
                      <span className="absolute -top-1 -left-1 w-3 h-3 rounded-full bg-blue-600 ring-2 ring-white" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div
                          className={cx(
                            "text-sm sm:text-base truncate",
                            hasUnread
                              ? "font-semibold text-gray-900"
                              : "font-medium text-gray-900"
                          )}
                          title={listingLine}
                        >
                          {listingLine}
                        </div>

                        {subLine && (
                          <div
                            className={cx(
                              "text-xs sm:text-sm truncate",
                              hasUnread ? "text-gray-700" : "text-gray-600"
                            )}
                            title={subLine}
                          >
                            {subLine}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 text-right">
                        <div
                          className={cx(
                            "text-sm sm:text-base",
                            hasUnread
                              ? "font-semibold text-gray-900"
                              : "font-medium text-gray-900"
                          )}
                          title={priceStr}
                        >
                          {priceStr}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">{timeAgo}</div>
                      </div>
                    </div>

                    <div className="mt-1 text-xs sm:text-sm text-gray-700 truncate">
                      <span className="text-gray-500">{info.counterpartyRoleLabel}:</span>{" "}
                      <span
                        className={cx(
                          hasUnread ? "font-semibold text-gray-800" : "font-medium"
                        )}
                      >
                        {info.counterpartyName}
                      </span>

                      {(() => {
                        const ageLabel = getAccountAgeLabel(info.counterpartyCreatedAt);
                        if (!ageLabel) return null;
                        return (
                          <span className="ml-2 text-[11px] text-gray-500">• {ageLabel}</span>
                        );
                      })()}
                    </div>

                    {locationLine && (
                      <div className="mt-1 text-[11px] sm:text-xs text-gray-500 truncate">
                        📍 {locationLine}
                      </div>
                    )}

                    <div
                      className={cx(
                        "mt-2 text-xs sm:text-sm truncate",
                        otherTyping
                          ? "text-gray-800 font-semibold"
                          : hasUnread
                          ? "text-gray-800 font-medium"
                          : "text-gray-500"
                      )}
                      title={lastMsg}
                    >
                      {lastMsg}
                    </div>
                  </div>

                  <div className="shrink-0 flex flex-col items-end justify-between gap-2">
                    {hasUnread ? (
                      <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-1 rounded-full text-xs font-semibold bg-blue-600 text-white">
                        {unreadCount}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600 border">
                        💬 {totalMsgBubble}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        hideConversation(c.id, c);
                      }}
                      className={cx(
                        "inline-flex items-center justify-center",
                        "h-9 w-9 rounded-md border bg-white",
                        "hover:bg-red-50 hover:border-red-200 active:bg-red-100",
                        "text-gray-600 hover:text-red-700",
                        "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                      )}
                      title="Sohbeti sil"
                      aria-label="Sohbeti sil"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {!loading && !loadError && hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setPageSize((p) => clampInt(p + 20, 10, 200))}
            className="px-4 py-2 rounded-md border hover:bg-gray-50 active:bg-gray-100 text-sm"
          >
            Daha fazla yükle
          </button>
        </div>
      )}

      {!loading && !loadError && conversations.length > 0 && (
        <div className="mt-6 text-xs text-gray-500 space-y-1">
          <div>Not: Mesajlar son mesaja göre otomatik sıralanır (default).</div>
          <div>
            Okunmamış yokken görünen 💬 sayısı artık{" "}
            <span className="font-mono">totalMessages - clearedCount</span> ile hesaplanır.
          </div>
          <div>
            <span className="font-mono">hideConversation / markConversationAsRead</span>{" "}
            fonksiyonları ileride gerekirse hazır duruyor.
          </div>
        </div>
      )}
    </div>
  );
}
