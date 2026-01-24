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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      await uploadBytes(imgRef, file);
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
      className="flex flex-col overflow-hidden"
      style={{ height: "calc(100vh - var(--app-header-height, 0px))" }}
    >
      {/* Listing header */}
      {conversation?.listingSnapshot && (
        <div
          onClick={() => {
            if (listingId) router.push(`/ilan/${listingId}`);
          }}
          className="shrink-0 border-b p-3 bg-white hover:bg-gray-50 cursor-pointer"
        >
          <div className="flex gap-3 items-start">
            {conversation.listingSnapshot.imageUrl ? (
              <img
                src={conversation.listingSnapshot.imageUrl}
                className="w-20 h-20 object-cover rounded border"
                alt="İlan görseli"
              />
            ) : (
              <div className="w-20 h-20 bg-gray-200 rounded" />
            )}

            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">
                {conversation.listingSnapshot.brandName} {conversation.listingSnapshot.modelName}
              </div>
              <div className="text-sm text-gray-600">
                {conversation.listingSnapshot.price} ₺
              </div>

              <div className="mt-2 flex items-center gap-2">
                {avatar ? (
                  <img
                    src={avatar}
                    className="w-6 h-6 rounded-full object-cover"
                    alt="Profil"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-gray-300" />
                )}
                <span className="text-xs text-gray-700">{displayName}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {messages.map((m) => {
          const mine = m.senderId === userId;
          const seen = isSeenByOther(m);

          return (
            <div
              key={m.id}
              className={cx(
                "max-w-xs p-2 rounded",
                mine ? "bg-blue-500 text-white ml-auto" : "bg-gray-200 mr-auto"
              )}
            >
              {/* Content */}
              {m.type === "image" ? (
                <img src={m.imageUrl} className="max-w-full rounded" alt="Mesaj görseli" />
              ) : (
                <div className="whitespace-pre-wrap break-words">{m.text}</div>
              )}

              {/* Meta */}
              <div
                className={cx(
                  "mt-1 text-[11px] flex items-center justify-end gap-1 opacity-90",
                  mine ? "text-white/90" : "text-gray-600"
                )}
              >
                <span>{formatClockTR(m.createdAt)}</span>
                {mine && <span className="ml-1">{seen ? "✓✓" : "✓"}</span>}
              </div>
            </div>
          );
        })}

        {/* Typing fake message */}
        {otherIsTyping && (
          <div className="max-w-xs p-2 rounded bg-gray-200 mr-auto">
            <div className="inline-flex items-center gap-1">
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" />
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:120ms]" />
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:240ms]" />
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 p-3 border-t flex gap-2 bg-white">
        <input
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
          className="border rounded px-3 py-2 flex-1"
          placeholder="Mesaj yaz..."
        />

        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              sendImage(e.target.files[0]);
              e.currentTarget.value = "";
            }
          }}
        />

        <button
          onClick={sendText}
          disabled={!text.trim()}
          className={cx(
            "px-4 rounded text-white",
            text.trim() ? "bg-blue-600 hover:bg-blue-700" : "bg-blue-300 cursor-not-allowed"
          )}
        >
          Gönder
        </button>
      </div>
    </div>
  );
}
