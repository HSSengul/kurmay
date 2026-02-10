"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { auth, db, storage } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  addDoc,
  updateDoc,
  increment,
  Timestamp,
  DocumentData,
  QuerySnapshot,
  DocumentSnapshot,
  limit,
  startAfter,
  getDocs,
  where,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

type Message = {
  id: string;
  senderId: string;
  type: "text" | "image";
  text?: string;
  imageUrl?: string;
  createdAt: any;
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function safeText(v: any, fallback = ""): string {
  if (typeof v === "string") return v;
  if (v == null) return fallback;
  return String(v);
}

function getTimestampMillis(ts: any): number {
  if (!ts) return 0;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  return 0;
}

function formatClockTR(ts: any) {
  const ms = getTimestampMillis(ts);
  if (!ms) return "";
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

function getDayKey(ts: any) {
  const ms = getTimestampMillis(ts);
  if (!ms) return "";
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDayTR(ts: any) {
  const ms = getTimestampMillis(ts);
  if (!ms) return "";
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(new Date(ms));
  } catch {
    return "";
  }
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

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const rawConversationId = (params as any)?.conversationId;

  const conversationId: string | null = Array.isArray(rawConversationId)
    ? rawConversationId[0] ?? null
    : typeof rawConversationId === "string"
    ? rawConversationId
    : null;

  const [userId, setUserId] = useState<string | null>(null);

  const [convoLoaded, setConvoLoaded] = useState(false);
  const [conversation, setConversation] = useState<any>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");

  const [nowTick, setNowTick] = useState<number>(Date.now());
  const [liveCounterpartyProfile, setLiveCounterpartyProfile] = useState<any>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // 👇 UI behavior refs
  const isAtBottomRef = useRef(true);

  // 👇 “mark as read” throttle
  const markAsReadInFlightRef = useRef(false);
  const lastMarkAsReadAtRef = useRef<number>(0);

  // 👇 typing throttling
  const typingInFlightRef = useRef(false);
  const lastTypingWriteAtRef = useRef<number>(0);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localTypingRef = useRef<boolean>(false);
  const pendingTypingRef = useRef<boolean | null>(null);
  const typingFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 👇 pagination state
  const fetchingOlderRef = useRef(false);
  const hasMoreRef = useRef(true);

  // 👇 send spam guard
  const sendTextInFlightRef = useRef(false);
  const sendImageInFlightRef = useRef(false);

  // 👇 keep latest messages in ref for scroll handler (no re-bind needed)
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  function getMyRoleSafe(convo: any, uid: string) {
    return convo?.buyerId === uid ? "buyer" : "seller";
  }

  function getOtherRoleSafe(convo: any, uid: string) {
    return convo?.buyerId === uid ? "seller" : "buyer";
  }

  function isAtBottom(el: HTMLDivElement) {
    const threshold = 80;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
  }

  function scheduleTypingFlush(delayMs: number) {
    if (typingFlushTimerRef.current) {
      clearTimeout(typingFlushTimerRef.current);
      typingFlushTimerRef.current = null;
    }

    typingFlushTimerRef.current = setTimeout(() => {
      typingFlushTimerRef.current = null;

      const pending = pendingTypingRef.current;
      if (pending === null) return;
      if (!conversationId || !userId || !conversation) return;

      if (localTypingRef.current !== pending) {
        writeTyping(pending);
      } else {
        pendingTypingRef.current = null;
      }
    }, Math.max(0, delayMs));
  }

  async function writeTyping(isTyping: boolean) {
    try {
      if (!conversationId || !userId || !conversation) return;
      const role = getMyRoleSafe(conversation, userId);

      // no-op
      if (localTypingRef.current === isTyping) {
        if (pendingTypingRef.current === isTyping) {
          pendingTypingRef.current = null;
        }
        return;
      }

      const nowMs = Date.now();
      const elapsed = nowMs - lastTypingWriteAtRef.current;

      // throttle
      if (elapsed < 700) {
        pendingTypingRef.current = isTyping;
        scheduleTypingFlush(700 - elapsed + 20);
        return;
      }

      // in-flight
      if (typingInFlightRef.current) {
        pendingTypingRef.current = isTyping;
        scheduleTypingFlush(250);
        return;
      }

      typingInFlightRef.current = true;
      lastTypingWriteAtRef.current = nowMs;

      const now = Timestamp.now();
      await updateDoc(doc(db, "conversations", conversationId), {
        [`typing.${role}`]: isTyping,
        "typing.updatedAt": now,
        "typing.by": userId,
      });

      localTypingRef.current = isTyping;
      pendingTypingRef.current = null;
    } finally {
      typingInFlightRef.current = false;
    }
  }

  function scheduleTypingStop() {
    if (typingStopTimerRef.current) {
      clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }
    typingStopTimerRef.current = setTimeout(() => {
      writeTyping(false);
    }, 1200);
  }

  // cleanup typing timers + stop typing on unmount
  useEffect(() => {
    return () => {
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      if (typingFlushTimerRef.current) clearTimeout(typingFlushTimerRef.current);
      writeTyping(false);
    };
  }, [conversationId, userId]);

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUserId(u ? u.uid : null);
    });
    return () => unsub();
  }, []);

  // ✅ reset chat state when switching conversationId
  useEffect(() => {
    setConvoLoaded(false);
    setConversation(null);
    setMessages([]);
    setText("");

    hasMoreRef.current = true;
    fetchingOlderRef.current = false;
    isAtBottomRef.current = true;

    localTypingRef.current = false;
    pendingTypingRef.current = null;

    // scroll to bottom after switch
    const el = scrollRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [conversationId]);

  // conversation live
  useEffect(() => {
    if (!conversationId) return;

    const unsub = onSnapshot(
      doc(db, "conversations", conversationId),
      (snap: DocumentSnapshot<DocumentData>) => {
        setConvoLoaded(true);
        if (!snap.exists()) {
          setConversation(null);
          return;
        }
        setConversation(snap.data());
      },
      (err) => {
        console.error("Conversation snapshot error:", err);
        setConvoLoaded(true);
        setConversation(null);
      }
    );

    return () => unsub();
  }, [conversationId]);

  const counterpartyUid =
    conversation?.buyerId === userId ? conversation?.sellerId : conversation?.buyerId;

  // counterparty public profile live
  useEffect(() => {
    if (!counterpartyUid) return;

    const unsub = onSnapshot(doc(db, "publicProfiles", counterpartyUid), (snap) => {
      if (snap.exists()) setLiveCounterpartyProfile(snap.data());
    });

    return () => unsub();
  }, [counterpartyUid]);

  // ✅ clearedAt cutoff (SİLEN KİŞİ ESKİ MESAJLARI GÖRMEZ)
  const myClearCutoffTs = useMemo(() => {
    if (!conversation || !userId) return null;
    const role = getMyRoleSafe(conversation, userId) as "buyer" | "seller";
    const ts = conversation?.clearedAt?.[role] ?? null;
    if (!ts) return null;
    return ts;
  }, [conversation, userId]);

  const myClearCutoffMs = useMemo(() => {
    return getTimestampMillis(myClearCutoffTs);
  }, [myClearCutoffTs]);

  // messages live: newest 30 (desc) + stable cursor using __name__
  useEffect(() => {
    if (!conversationId) return;

    const baseRef = collection(db, "conversations", conversationId, "messages");

    const constraints: any[] = [];

    // ✅ Eğer clearedAt varsa sadece clearedAt SONRASI mesajları çek
    if (myClearCutoffTs) {
      constraints.push(where("createdAt", ">", myClearCutoffTs));
    }

    constraints.push(orderBy("createdAt", "desc"));
    constraints.push(orderBy("__name__", "desc"));
    constraints.push(limit(30));

    const q = query(baseRef, ...constraints);

    const unsub = onSnapshot(
      q,
      (snap: QuerySnapshot<DocumentData>) => {
        const incoming: Message[] = [];
        snap.forEach((d) => incoming.push({ id: d.id, ...d.data() } as Message));

        // incoming is desc => reverse for UI
        const ordered = incoming.reverse();

        setMessages((prev) => {
          // ✅ Eğer clearedAt varsa, prev içindeki eski mesajları komple temizle
          const filteredPrev =
            myClearCutoffMs > 0
              ? prev.filter((m) => getTimestampMillis(m.createdAt) > myClearCutoffMs)
              : prev;

          const map = new Map(filteredPrev.map((m) => [m.id, m]));
          ordered.forEach((m) => map.set(m.id, m));

          const out = Array.from(map.values());
          out.sort((a, b) => {
            const am = getTimestampMillis(a.createdAt);
            const bm = getTimestampMillis(b.createdAt);
            if (am !== bm) return am - bm;
            return a.id.localeCompare(b.id);
          });

          return out;
        });
      },
      (err) => {
        console.error("Messages snapshot error:", err);
      }
    );

    return () => unsub();
  }, [conversationId, myClearCutoffTs, myClearCutoffMs]);

  // ✅ auto-scroll to bottom when user already at bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (isAtBottomRef.current) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [messages.length]);

  // ✅ Scroll listener ONLY ONCE (no render leak)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      isAtBottomRef.current = isAtBottom(el);
      if (el.scrollTop < 120) {
        fetchOlder();
      }
    };

    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  async function fetchOlder() {
    const cid = conversationId;
    if (!cid || fetchingOlderRef.current || !hasMoreRef.current) return;

    const current = messagesRef.current;
    if (!current || current.length === 0) return;

    fetchingOlderRef.current = true;

    const el = scrollRef.current;

    try {
      if (!el) return;

      const prevScrollHeight = el.scrollHeight;
      const prevScrollTop = el.scrollTop;

      const oldest = current[0];

      const baseRef = collection(db, "conversations", cid, "messages");
      const constraints: any[] = [];

      // ✅ clearedAt varsa burada da filtrele
      if (myClearCutoffTs) {
        constraints.push(where("createdAt", ">", myClearCutoffTs));
      }

      constraints.push(orderBy("createdAt", "desc"));
      constraints.push(orderBy("__name__", "desc"));
      constraints.push(startAfter(oldest.createdAt, oldest.id));
      constraints.push(limit(30));

      const q = query(baseRef, ...constraints);

      const snap = await getDocs(q);

      if (snap.empty) {
        hasMoreRef.current = false;
        return;
      }

      const older: Message[] = [];
      snap.forEach((d) => older.push({ id: d.id, ...d.data() } as Message));
      const ordered = older.reverse();

      setMessages((prev) => {
        const filteredPrev =
          myClearCutoffMs > 0
            ? prev.filter((m) => getTimestampMillis(m.createdAt) > myClearCutoffMs)
            : prev;

        return [...ordered, ...filteredPrev];
      });

      requestAnimationFrame(() => {
        const newScrollHeight = el.scrollHeight;
        el.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
      });
    } catch (err) {
      console.error("fetchOlder error:", err);
    } finally {
      fetchingOlderRef.current = false;
    }
  }

  // ✅ mark conversation as read (unread reset + lastReadAt)
  useEffect(() => {
    if (!conversation || !userId || !conversationId) return;

    const role = conversation.buyerId === userId ? "buyer" : "seller";
    const unreadCount = conversation?.unread?.[role] ?? 0;
    if (unreadCount === 0) return;

    if (markAsReadInFlightRef.current) return;

    const nowMs = Date.now();
    if (nowMs - lastMarkAsReadAtRef.current < 400) return;

    markAsReadInFlightRef.current = true;
    lastMarkAsReadAtRef.current = nowMs;

    const now = Timestamp.now();
    updateDoc(doc(db, "conversations", conversationId), {
      [`unread.${role}`]: 0,
      [`lastReadAt.${role}`]: now,
    }).finally(() => {
      markAsReadInFlightRef.current = false;
    });
  }, [
    conversationId,
    userId,
    conversation?.buyerId,
    conversation?.sellerId,
    conversation?.unread?.buyer,
    conversation?.unread?.seller,
  ]);

  // ✅ “seen” ticks based on lastReadAt of counterparty (no extra writes)
  const otherRole = useMemo(() => {
    if (!conversation || !userId) return null;
    return getOtherRoleSafe(conversation, userId) as "buyer" | "seller";
  }, [conversation, userId]);

  function isSeenByOther(m: Message) {
    if (!conversation || !userId || !otherRole) return false;
    if (m.senderId !== userId) return false;

    const otherLastReadAt = conversation?.lastReadAt?.[otherRole];
    const otherMs = getTimestampMillis(otherLastReadAt);
    const msgMs = getTimestampMillis(m.createdAt);

    if (!otherMs || !msgMs) return false;
    return otherMs >= msgMs;
  }

  async function sendText() {
    if (!conversationId || !userId || !conversation) return;

    const clean = text.trim();
    if (!clean) return;

    if (sendTextInFlightRef.current) return;
    sendTextInFlightRef.current = true;

    try {
      const now = Timestamp.now();
      await writeTyping(false);

      await addDoc(collection(db, "conversations", conversationId, "messages"), {
        senderId: userId,
        type: "text",
        text: clean,
        createdAt: now,
      });

      const other = conversation.buyerId === userId ? "seller" : "buyer";

      await updateDoc(doc(db, "conversations", conversationId), {
        lastMessage: {
          type: "text",
          text: clean,
          senderId: userId,
          createdAt: now,
        },
        lastMessageAt: now,
        [`unread.${other}`]: increment(1),
        totalMessages: increment(1),

        // ✅ biri sohbeti silmişse, yeni mesajla sohbet geri gelsin (inbox'ta görünsün)
        "deletedFor.buyer": false,
        "deletedFor.seller": false,
      });

      setText("");
    } catch (err) {
      console.error("sendText error:", err);
    } finally {
      sendTextInFlightRef.current = false;
    }
  }

  async function sendImage(file: File) {
    if (!conversationId || !userId || !conversation || !file) return;

    // ✅ size guard (8MB)
    const maxBytes = 8 * 1024 * 1024;
    if (file.size > maxBytes) {
      alert("Fotoğraf çok büyük. Lütfen 8MB altı bir görsel yükle.");
      return;
    }

    if (sendImageInFlightRef.current) return;
    sendImageInFlightRef.current = true;

    try {
      const now = Timestamp.now();
      await writeTyping(false);

      const imgRef = ref(storage, `chatImages/${conversationId}/${Date.now()}_${file.name}`);
      await uploadBytes(imgRef, file, {
        contentType: file.type || "image/jpeg",
      });
      const url = await getDownloadURL(imgRef);

      await addDoc(collection(db, "conversations", conversationId, "messages"), {
        senderId: userId,
        type: "image",
        imageUrl: url,
        createdAt: now,
      });

      const other = conversation.buyerId === userId ? "seller" : "buyer";

      await updateDoc(doc(db, "conversations", conversationId), {
        lastMessage: {
          type: "image",
          senderId: userId,
          createdAt: now,
          imageUrl: url,
        },
        lastMessageAt: now,
        [`unread.${other}`]: increment(1),
        totalMessages: increment(1),

        // ✅ biri sohbeti silmişse, yeni mesajla sohbet geri gelsin (inbox'ta görünsün)
        "deletedFor.buyer": false,
        "deletedFor.seller": false,
      });
    } catch (err) {
      console.error("sendImage error:", err);
    } finally {
      sendImageInFlightRef.current = false;
    }
  }

  // states
  if (!conversationId) {
    return <div className="p-6">Geçersiz sohbet ID.</div>;
  }

  if (!convoLoaded) {
    return <div className="p-6">Yükleniyor...</div>;
  }

  if (!conversation) {
    return (
      <div className="p-6">
        <div className="border rounded-lg p-4 bg-white">
          <div className="font-semibold">Sohbet bulunamadı</div>
          <div className="mt-1 text-sm text-gray-600">
            Bu sohbet silinmiş olabilir veya erişim iznin olmayabilir.
          </div>

          <button
            onClick={() => router.push("/my/messages")}
            className="mt-3 px-4 py-2 rounded bg-blue-600 text-white"
          >
            Mesajlara dön
          </button>
        </div>
      </div>
    );
  }

  const snapshotCounterparty =
    conversation.buyerId === userId ? conversation.sellerSnapshot : conversation.buyerSnapshot;

  const avatar =
    liveCounterpartyProfile?.avatarUrl || snapshotCounterparty?.avatarUrl || "";

  const displayName =
    liveCounterpartyProfile?.displayName || snapshotCounterparty?.displayName || "";

  const listingId =
    conversation?.listingSnapshot?.listingId || conversation?.listingId || null;

  const typingMap = conversation?.typing || null;
  const typingUpdatedAt: any = typingMap?.updatedAt;
  const typingUpdatedAtMs =
    typingUpdatedAt?.toMillis?.() ??
    (typingUpdatedAt?.seconds ? typingUpdatedAt.seconds * 1000 : 0);

  const typingFresh = typingUpdatedAtMs > 0 && nowTick - typingUpdatedAtMs < 8000;
  const otherRoleForTyping =
    conversation?.buyerId && userId ? getOtherRoleSafe(conversation, userId) : null;

  const otherIsTyping =
    !!otherRoleForTyping && typingFresh && typingMap?.[otherRoleForTyping] === true;

  return (
    <div
      className="flex flex-col overflow-hidden bg-[radial-gradient(120%_90%_at_10%_0%,#fff7ea_0%,#f7f4ef_45%,#f1ece3_100%)]"
      style={{ height: "calc(100vh - var(--app-header-height, 0px))" }}
    >
      {/* Listing header */}
      {conversation?.listingSnapshot && (
        <div className="shrink-0 border-b border-[#ead8c5] bg-[#fffaf3]/95 backdrop-blur">
          <div className="max-w-5xl mx-auto px-4 py-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="w-full sm:w-28">
                {conversation.listingSnapshot.imageUrl ? (
                  <img
                    src={conversation.listingSnapshot.imageUrl}
                    className="w-full h-24 sm:h-24 object-cover rounded-2xl border border-[#ead8c5] shadow-[0_6px_18px_rgba(0,0,0,0.08)]"
                    alt="İlan görseli"
                  />
                ) : (
                  <div className="w-full h-24 rounded-2xl bg-[#f3e9db] border border-[#ead8c5]" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-[#7a5a40]">
                  <span className="rounded-full border border-[#ead8c5] bg-white px-2 py-1">
                    {safeText(conversation.listingSnapshot.categoryName, "Kategori")}
                  </span>
                  <span className="rounded-full border border-[#ead8c5] bg-white px-2 py-1">
                    {safeText(conversation.listingSnapshot.subCategoryName, "Alt kategori")}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <div className="text-lg sm:text-xl font-semibold text-[#2f241b] line-clamp-1">
                    {safeText(conversation.listingSnapshot.title, "İlan")}
                  </div>
                  <span className="inline-flex items-center rounded-full border border-[#ead8c5] bg-white px-3 py-1 text-sm font-semibold text-[#3f2a1a] shadow-sm">
                    {formatTryPrice(Number(conversation.listingSnapshot.price ?? 0))}
                  </span>
                </div>

                <div className="mt-2 flex items-center gap-2 text-xs text-[#6b4b33]">
                  {avatar ? (
                    <img
                      src={avatar}
                      className="w-7 h-7 rounded-full object-cover border border-[#ead8c5]"
                      alt="Profil"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-[#f3e9db] border border-[#ead8c5]" />
                  )}
                  <span className="font-semibold">{displayName || "Kullanıcı"}</span>
                  <span className="text-[#9a7a5f]">•</span>
                  <span className="text-[#9a7a5f]">Sohbet</span>
                </div>
              </div>

              <button
                onClick={() => {
                  if (listingId) router.push(`/ilan/${listingId}`);
                }}
                className="self-start sm:self-center rounded-2xl border border-[#ead8c5] bg-white px-4 py-2 text-sm font-semibold text-[#3f2a1a] hover:bg-[#fff2e6] transition shadow-sm"
              >
                İlana git
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-5 bg-[#f7f4ef]">
        <div className="max-w-5xl mx-auto space-y-4">
          {(() => {
            let lastDayKey = "";
            return messages.map((m) => {
              const dayKey = getDayKey(m.createdAt);
              const showDay = dayKey && dayKey !== lastDayKey;
              if (showDay) lastDayKey = dayKey;

              const mine = m.senderId === userId;
              const seen = isSeenByOther(m);

              return (
                <div key={m.id} className="space-y-2">
                  {showDay && (
                    <div className="flex items-center gap-3 py-1">
                      <div className="h-px flex-1 bg-[#ead8c5]" />
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#9a7a5f]">
                        {formatDayTR(m.createdAt)}
                      </span>
                      <div className="h-px flex-1 bg-[#ead8c5]" />
                    </div>
                  )}

                  <div className={cx("flex", mine ? "justify-end" : "justify-start")}>
                    <div
                      className={cx(
                        "max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-3 border shadow-[0_8px_24px_rgba(0,0,0,0.08)]",
                        mine
                          ? "bg-gradient-to-br from-[#1f2a24] via-[#22332a] to-[#2b3b32] text-white border-transparent rounded-br-md"
                          : "bg-white text-[#2f2a24] border-[#ead8c5] rounded-bl-md"
                      )}
                    >
                      {/* Content */}
                      {m.type === "image" ? (
                        <img
                          src={m.imageUrl}
                          className="max-w-full rounded-xl border border-white/10"
                          alt="Mesaj görseli"
                        />
                      ) : (
                        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                          {m.text}
                        </div>
                      )}

                      {/* Meta */}
                      <div
                        className={cx(
                          "mt-2 text-[11px] flex items-center gap-1",
                          mine ? "justify-end text-white/75" : "justify-start text-[#8a6a4f]"
                        )}
                      >
                        <span>{formatClockTR(m.createdAt)}</span>
                        {mine && <span className="ml-1">{seen ? "✓✓" : "✓"}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            });
          })()}

          {/* Typing fake message */}
          {otherIsTyping && (
            <div className="flex justify-start">
              <div className="max-w-[70%] rounded-2xl rounded-bl-md border border-[#ead8c5] bg-white px-4 py-3 shadow-sm">
                <div className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 bg-[#8a6a4f] rounded-full animate-bounce" />
                  <span className="w-2 h-2 bg-[#8a6a4f] rounded-full animate-bounce [animation-delay:120ms]" />
                  <span className="w-2 h-2 bg-[#8a6a4f] rounded-full animate-bounce [animation-delay:240ms]" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-[#ead8c5] bg-white/95">
        <div className="max-w-5xl mx-auto px-4 py-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-2 rounded-3xl border border-[#ead8c5] bg-white px-3 py-2 shadow-sm">
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (userId && conversationId && conversation) {
                    writeTyping(true);
                    scheduleTypingStop();
                  }
                }}
                onBlur={() => writeTyping(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendText();
                  }
                }}
                rows={1}
                className="w-full flex-1 resize-none bg-transparent px-2 py-2 text-sm text-[#3f2a1a] focus:outline-none"
                placeholder="Mesaj yaz..."
              />

              <label className="inline-flex items-center justify-center rounded-2xl border border-[#ead8c5] bg-white px-4 py-2 text-sm font-semibold text-[#3f2a1a] hover:bg-[#fff2e6] transition cursor-pointer">
                Fotoğraf
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      sendImage(e.target.files[0]);
                      e.currentTarget.value = "";
                    }
                  }}
                />
              </label>

              <button
                onClick={sendText}
                disabled={!text.trim()}
                className={cx(
                  "px-5 rounded-2xl text-sm font-semibold text-white transition",
                  text.trim()
                    ? "bg-[#1f2a24] hover:bg-[#2b3b32]"
                    : "bg-[#b9c9bf] cursor-not-allowed"
                )}
              >
                Gönder
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
