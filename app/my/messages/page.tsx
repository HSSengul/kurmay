"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { devError, getFriendlyErrorMessage } from "@/lib/logger";
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
    categoryName?: string;
    subCategoryName?: string;
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
  const category = safeString(c.listingSnapshot?.categoryName, "").trim();
  const subCategory = safeString(c.listingSnapshot?.subCategoryName, "").trim();
  if (category || subCategory) return `${category} ${subCategory}`.trim();
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
    <div className="border border-[#ead8c5] rounded-2xl p-3 sm:p-4 bg-white/80">
      <div className="flex gap-3">
        <div className="w-14 h-14 sm:w-16 sm:h-16 bg-[#f3e7d8] rounded-xl animate-pulse" />
        <div className="flex-1">
          <div className="h-4 bg-[#f3e7d8] rounded w-2/3 animate-pulse" />
          <div className="mt-2 h-3 bg-[#f3e7d8] rounded w-1/3 animate-pulse" />
          <div className="mt-2 h-3 bg-[#f3e7d8] rounded w-5/6 animate-pulse" />
          <div className="mt-2 flex gap-2">
            <div className="h-5 bg-[#f3e7d8] rounded w-16 animate-pulse" />
            <div className="h-5 bg-[#f3e7d8] rounded w-20 animate-pulse" />
            <div className="h-5 bg-[#f3e7d8] rounded w-14 animate-pulse" />
          </div>
        </div>
        <div className="w-20 sm:w-28 flex flex-col items-end gap-2">
          <div className="h-4 bg-[#f3e7d8] rounded w-16 animate-pulse" />
          <div className="h-3 bg-[#f3e7d8] rounded w-12 animate-pulse" />
          <div className="h-6 bg-[#f3e7d8] rounded w-10 animate-pulse" />
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
        devError("MessagesPage onSnapshot error:", err);
        setLoading(false);
        setHasMore(false);
        setLoadError(getFriendlyErrorMessage(err, "Mesajlar yüklenemedi."));
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
      devError("hideConversation error:", err);
      showToast({
        type: "error",
        text: getFriendlyErrorMessage(err, "Sohbet silinemedi."),
      });
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
      devError("markConversationAsRead error:", err);
      showToast({
        type: "error",
        text: getFriendlyErrorMessage(err, "Okundu işaretlenemedi."),
      });
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
      <div className="min-h-screen bg-[#f7f4ef] bg-[radial-gradient(circle_at_top,_#fff7ed,_#f7f4ef_55%)]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
          <div className="border border-[#ead8c5] rounded-2xl p-6 bg-white/80 shadow-[0_20px_50px_-40px_rgba(15,23,42,0.45)]">
            <div className="text-lg font-semibold text-[#3f2a1a]">Mesajlar</div>
            <div className="mt-2 text-sm text-[#6b4b33]">
              Bu sayfayı görmek için giriş yapmalısın.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const list = computed.list;
  const totalUnread = computed.totalUnread;

  return (
    <div className="min-h-screen bg-[#f7f4ef] bg-[radial-gradient(circle_at_top,_#fff7ed,_#f7f4ef_55%)]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-4">
      {toast && (
        <div
          className={cx(
            "fixed z-50 left-1/2 -translate-x-1/2 top-4",
            "px-4 py-2 rounded-full shadow border text-sm",
            toast.type === "success" &&
              "bg-emerald-50 border-emerald-200 text-emerald-800",
            toast.type === "error" &&
              "bg-rose-50 border-rose-200 text-rose-800",
            toast.type === "info" &&
              "bg-amber-50 border-amber-200 text-amber-900"
          )}
        >
          {toast.text}
        </div>
      )}

      <div className="sticky top-[calc(var(--app-header-height,0px)+12px)] z-10 bg-[#fffaf3]/95 backdrop-blur border border-[#ead8c5] rounded-2xl px-4 sm:px-5 py-4 shadow-[0_18px_45px_-35px_rgba(15,23,42,0.45)] my-fade-up">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold leading-tight tracking-tight text-[#3f2a1a]">
              Mesajlar
            </h1>

            <div className="text-xs sm:text-sm text-[#6b4b33]">
              {loading ? (
                "Yükleniyor…"
              ) : (
                <>
                  {list.length} sohbet
                  {totalUnread > 0 ? (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[#1f2a24] text-white px-2 py-0.5 text-[11px]">
                      {totalUnread} okunmamış
                    </span>
                  ) : (
                    <span className="ml-2 text-[#9b7b5a]">• okunmamış yok</span>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setNowTick(Date.now())}
              className="text-xs sm:text-sm px-3 py-2 rounded-full border border-[#ead8c5] text-[#3f2a1a] hover:bg-[#f7ede2] active:bg-[#f1e0cd]"
              title="Zaman bilgisini yenile"
            >
              <span aria-hidden>⟳</span>
              <span className="sr-only">Yenile</span>
            </button>

            <button
              type="button"
              onClick={() => showToast({ type: "info", text: "Mesajlar anlık güncelleniyor." })}
              className="text-xs sm:text-sm px-3 py-2 rounded-full border border-[#ead8c5] text-[#3f2a1a] hover:bg-[#f7ede2] active:bg-[#f1e0cd]"
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
                className="w-full border border-[#ead8c5] rounded-full px-3.5 py-2 text-sm bg-white/70 text-[#3f2a1a] placeholder:text-[#9b7b5a] outline-none focus:ring-2 focus:ring-[#e7c49b]"
              />
              <div className="mt-1 text-[11px] text-[#9b7b5a]">
                Örn: “Lego”, “Kadıköy”, “125000”, “fotoğraf”
              </div>
            </div>

            <div className="flex gap-2 sm:flex-col sm:w-[220px]">
              <label className="flex items-center gap-2 border border-[#ead8c5] rounded-full px-3 py-2 text-sm bg-white/70 text-[#3f2a1a]">
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
                className="border border-[#ead8c5] rounded-full px-3 py-2 text-sm bg-white/70 text-[#3f2a1a]"
                title="Sıralama"
              >
                <option value="lastMessageDesc">Son mesaja göre</option>
                <option value="unreadFirst">Okunmamış önce</option>
                <option value="priceHigh">Fiyat (yüksek)</option>
                <option value="priceLow">Fiyat (düşük)</option>
              </select>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#9b7b5a]">
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1f2a24]" /> Okunmamış
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#caa07a]" /> Okundu (💬 toplam mesaj)
            </span>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="mt-4 border border-rose-200 rounded-2xl p-4 bg-rose-50/80">
          <div className="font-semibold text-rose-800">Mesajlar yüklenemedi</div>
          <div className="mt-1 text-sm text-rose-700">{loadError}</div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3 py-2 rounded-full bg-[#a03a2e] text-white text-sm hover:bg-[#8f2f25]"
            >
              Yeniden dene
            </button>
            <button
              type="button"
              onClick={() => setLoadError(null)}
              className="px-3 py-2 rounded-full border border-rose-200 text-sm text-rose-800 hover:bg-rose-50"
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
        <div className="mt-6 border border-[#ead8c5] rounded-2xl p-6 bg-white/80 shadow-[0_20px_50px_-40px_rgba(15,23,42,0.45)]">
          <div className="text-lg font-semibold text-[#3f2a1a]">
            Henüz mesajın yok
          </div>
          <div className="mt-2 text-sm text-[#6b4b33]">
            Bir ilana girip satıcıya mesaj atarak sohbet başlatabilirsin.
          </div>

          {search.trim().length > 0 && (
            <div className="mt-3 text-sm text-[#9b7b5a]">
              Arama filtresi nedeniyle görünmüyor olabilir.{" "}
              <button type="button" className="underline" onClick={() => setSearch("")}>
                Aramayı temizle
              </button>
              .
            </div>
          )}

          {onlyUnread && (
            <div className="mt-3 text-sm text-[#9b7b5a]">
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
        <div className="mt-5 space-y-3 my-fade-up">
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
                  "block border rounded-2xl bg-white/85 transition group shadow-[0_12px_30px_-24px_rgba(15,23,42,0.25)]",
                  hasUnread
                    ? "border-[#caa07a] ring-1 ring-[#ead8c5]"
                    : "border-[#ead8c5]",
                  "hover:bg-[#fff7ed] hover:shadow-[0_20px_45px_-30px_rgba(15,23,42,0.3)] active:bg-[#f7ede2]"
                )}
              >
                <div className="flex gap-3 p-3 sm:p-4">
                  <div className="relative w-14 h-14 sm:w-16 sm:h-16 shrink-0">
                    {imageUrl ? (
                      <Image
                        src={imageUrl}
                        alt="İlan görseli"
                        width={64}
                        height={64}
                        sizes="64px"
                        className={cx(
                          "w-full h-full object-cover rounded-xl",
                          hasUnread && "ring-2 ring-[#caa07a]"
                        )}
                      />
                    ) : (
                      <div
                        className={cx(
                          "w-full h-full rounded-xl bg-[#f3e7d8] flex items-center justify-center text-[#9b7b5a] text-xs",
                          hasUnread && "ring-2 ring-[#caa07a]"
                        )}
                      >
                        Görsel
                      </div>
                    )}

                    {hasUnread && (
                      <span className="absolute -top-1 -left-1 w-3 h-3 rounded-full bg-[#1f2a24] ring-2 ring-white" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div
                          className={cx(
                            "text-sm sm:text-base truncate",
                            hasUnread
                              ? "font-semibold text-[#3f2a1a]"
                              : "font-medium text-[#3f2a1a]"
                          )}
                          title={listingLine}
                        >
                          {listingLine}
                        </div>

                        {subLine && (
                          <div
                            className={cx(
                              "text-xs sm:text-sm truncate",
                              hasUnread ? "text-[#5a4330]" : "text-[#6b4b33]"
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
                              ? "font-semibold text-[#3f2a1a]"
                              : "font-medium text-[#3f2a1a]"
                          )}
                          title={priceStr}
                        >
                          {priceStr}
                        </div>
                        <div className="mt-0.5 text-xs text-[#9b7b5a]">{timeAgo}</div>
                      </div>
                    </div>

                    <div className="mt-1 text-xs sm:text-sm text-[#5a4330] truncate">
                      <span className="text-[#9b7b5a]">
                        {info.counterpartyRoleLabel}:
                      </span>{" "}
                      <span
                        className={cx(
                          hasUnread
                            ? "font-semibold text-[#3f2a1a]"
                            : "font-medium text-[#3f2a1a]"
                        )}
                      >
                        {info.counterpartyName}
                      </span>

                      {(() => {
                        const ageLabel = getAccountAgeLabel(info.counterpartyCreatedAt);
                        if (!ageLabel) return null;
                        return (
                          <span className="ml-2 text-[11px] text-[#9b7b5a]">
                            • {ageLabel}
                          </span>
                        );
                      })()}
                    </div>

                    {locationLine && (
                      <div className="mt-1 text-[11px] sm:text-xs text-[#9b7b5a] truncate">
                        📍 {locationLine}
                      </div>
                    )}

                    <div
                      className={cx(
                        "mt-2 text-xs sm:text-sm truncate",
                        otherTyping
                          ? "text-[#3f2a1a] font-semibold"
                          : hasUnread
                          ? "text-[#3f2a1a] font-medium"
                          : "text-[#8b6b52]"
                      )}
                      title={lastMsg}
                    >
                      {lastMsg}
                    </div>
                  </div>

                  <div className="shrink-0 flex flex-col items-end justify-between gap-2">
                    {hasUnread ? (
                      <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-1 rounded-full text-xs font-semibold bg-[#1f2a24] text-white">
                        {unreadCount}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-[#f7ede2] text-[#5a4330] border border-[#ead8c5]">
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
                        "h-9 w-9 rounded-full border border-[#ead8c5] bg-white",
                        "hover:bg-[#fdeeee] hover:border-[#f1b7b0] active:bg-[#f9d7d2]",
                        "text-[#8b6b52] hover:text-[#a03a2e]",
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
            className="px-4 py-2 rounded-full border border-[#ead8c5] text-sm text-[#3f2a1a] hover:bg-[#f7ede2] active:bg-[#f1e0cd]"
          >
            Daha fazla yükle
          </button>
        </div>
      )}

      {!loading && !loadError && conversations.length > 0 && (
        <div className="mt-6 text-xs text-[#9b7b5a] space-y-1">
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
    </div>
  );
}
