
"use client";

import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import { ToastView, useToast, cx, formatDateTR } from "@/app/components/admin/ui";
import { devError } from "@/lib/logger";

type UserRow = {
  id: string;
  email?: string;
  role?: "user" | "admin";
  createdAt?: any;
  provider?: string[];

  banStatus?: "none" | "temporary" | "permanent";
  banUntil?: any;
  banReason?: string;
  banUpdatedAt?: any;
  banUpdatedBy?: string;

  blockListings?: boolean;
  blockMessages?: boolean;

  adminNote?: string;
  riskLevel?: "low" | "medium" | "high";
  labels?: string[];
};

type PublicProfile = {
  name?: string;
  bio?: string;
  address?: string;
  phone?: string;
  websiteInstagram?: string;
  avatarUrl?: string;
  showPhone?: boolean;
  showAddress?: boolean;
  showWebsiteInstagram?: boolean;
  onboardingCompleted?: boolean;
  updatedAt?: any;
};

type PublicContact = {
  phone?: string;
  email?: string;
  address?: string;
  updatedAt?: any;
};

type ConversationRow = {
  id: string;
  listingId?: string;
  listingSnapshot?: any;
  lastMessage?: any;
  lastMessageAt?: any;
  buyerId?: string;
  sellerId?: string;
  participants?: string[];
};

type MessageRow = {
  id: string;
  senderId?: string;
  type?: "text" | "image" | "system";
  text?: string;
  imageUrl?: string;
  createdAt?: any;
};

function safeString(v: any, fallback = "") {
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

function initialsFrom(text: string) {
  const clean = text.trim();
  if (!clean) return "?";
  const parts = clean.split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function toLocalInputValue(ts: any) {
  const ms = getTimestampMillis(ts);
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(v: string) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return Timestamp.fromDate(d);
}

function banState(user: UserRow | null) {
  if (!user) return { active: false, mode: "none", untilMs: 0 } as const;
  const now = Date.now();
  const status = user.banStatus || "none";
  const untilMs = getTimestampMillis(user.banUntil);
  const tempActive = (status === "temporary" || status === "none") && untilMs > now;
  const permActive = status === "permanent";
  const active = permActive || tempActive;
  const mode = permActive ? "permanent" : tempActive ? "temporary" : "none";
  return { active, mode, untilMs } as const;
}

export default function AdminUsersPage() {
  const { toast, showToast } = useToast();
  const params = useSearchParams();

  const [adminId, setAdminId] = useState<string | null>(null);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);

  const [detailsLoading, setDetailsLoading] = useState(false);
  const [publicProfile, setPublicProfile] = useState<PublicProfile | null>(null);
  const [publicContact, setPublicContact] = useState<PublicContact | null>(null);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [listingCount, setListingCount] = useState<number | null>(null);
  const [conversationCount, setConversationCount] = useState<number | null>(null);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "user">("all");
  const [banFilter, setBanFilter] = useState<"all" | "banned" | "active">("all");

  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const [conversationMessages, setConversationMessages] = useState<
    Record<string, MessageRow[]>
  >({});
  const [conversationMessagesLoading, setConversationMessagesLoading] = useState<
    Record<string, boolean>
  >({});

  const [roleDraft, setRoleDraft] = useState<"user" | "admin">("user");
  const [riskDraft, setRiskDraft] = useState<"low" | "medium" | "high">("low");
  const [labelsDraft, setLabelsDraft] = useState("");
  const [adminNoteDraft, setAdminNoteDraft] = useState("");
  const [blockListingsDraft, setBlockListingsDraft] = useState(false);
  const [blockMessagesDraft, setBlockMessagesDraft] = useState(false);

  const [banMode, setBanMode] = useState<"none" | "temporary" | "permanent">("none");
  const [banUntilDraft, setBanUntilDraft] = useState("");
  const [banReasonDraft, setBanReasonDraft] = useState("");

  const [profileDraft, setProfileDraft] = useState<PublicProfile>({});
  const [contactDraft, setContactDraft] = useState<PublicContact>({});
  const [activeTab, setActiveTab] = useState<
    "overview" | "moderation" | "profile" | "contacts" | "messages"
  >("overview");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAdminId(u ? u.uid : null);
    });
    return () => unsub();
  }, []);

  async function loadUsers() {
    setLoading(true);
    try {
      let snap;
      try {
        const q = query(collection(db, "users"), orderBy("createdAt", "desc"), limit(500));
        snap = await getDocs(q);
      } catch {
        snap = await getDocs(collection(db, "users"));
      }

      const list: UserRow[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setUsers(list);

      if (!selectedId && list.length > 0) {
        setSelectedId(list[0].id);
      }
    } catch (err) {
      devError("Admin users load error", err);
      showToast({ type: "error", text: "Kullanıcılar yüklenemedi. Rules kontrol et." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    const uid = params.get("uid");
    if (uid && uid !== selectedId) {
      setSelectedId(uid);
    }
  }, [params, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedUser(null);
      return;
    }

    const found = users.find((u) => u.id === selectedId) || null;
    if (found) {
      setSelectedUser(found);
      return;
    }

    let alive = true;

    (async () => {
      try {
        const snap = await getDoc(doc(db, "users", selectedId));
        if (!alive) return;
        if (snap.exists()) {
          const row: UserRow = { id: snap.id, ...(snap.data() as any) };
          setSelectedUser(row);
          setUsers((prev) => (prev.some((u) => u.id === row.id) ? prev : [row, ...prev]));
        } else {
          setSelectedUser(null);
        }
      } catch (err) {
        devError("Admin user doc load error", err);
        if (!alive) return;
        setSelectedUser(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [selectedId, users]);

  useEffect(() => {
    if (!selectedId) return;

    let alive = true;

    async function loadDetails(uid: string) {
      setDetailsLoading(true);

      try {
        const [profileSnap, contactSnap] = await Promise.all([
          getDoc(doc(db, "publicProfiles", uid)),
          getDoc(doc(db, "publicContacts", uid)),
        ]);

        if (!alive) return;

        setPublicProfile(profileSnap.exists() ? (profileSnap.data() as PublicProfile) : null);
        setPublicContact(contactSnap.exists() ? (contactSnap.data() as PublicContact) : null);

        const [listingCountSnap, conversationCountSnap, conversationSnap] = await Promise.all([
          getCountFromServer(query(collection(db, "listings"), where("ownerId", "==", uid))),
          getCountFromServer(
            query(collection(db, "conversations"), where("participants", "array-contains", uid))
          ),
          getDocs(
            query(
              collection(db, "conversations"),
              where("participants", "array-contains", uid),
              orderBy("lastMessageAt", "desc"),
              limit(20)
            )
          ),
        ]);

        if (!alive) return;

        setListingCount(listingCountSnap.data().count || 0);
        setConversationCount(conversationCountSnap.data().count || 0);

        const convoList: ConversationRow[] = conversationSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));
        setConversations(convoList);
      } catch (err) {
        devError("Admin public profile load error", err);
        if (!alive) return;
        setPublicProfile(null);
        setPublicContact(null);
        setListingCount(null);
        setConversationCount(null);
        setConversations([]);
      } finally {
        if (!alive) return;
        setDetailsLoading(false);
      }
    }

    loadDetails(selectedId);

    return () => {
      alive = false;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedUser) return;
    setRoleDraft(selectedUser.role || "user");
    setRiskDraft(selectedUser.riskLevel || "low");
    setLabelsDraft((selectedUser.labels || []).join(", "));
    setAdminNoteDraft(selectedUser.adminNote || "");
    setBlockListingsDraft(!!selectedUser.blockListings);
    setBlockMessagesDraft(!!selectedUser.blockMessages);

    const status = selectedUser.banStatus || "none";
    setBanMode(status);
    setBanUntilDraft(toLocalInputValue(selectedUser.banUntil));
    setBanReasonDraft(selectedUser.banReason || "");
  }, [selectedUser]);

  useEffect(() => {
    if (selectedId) {
      setActiveTab("overview");
    }
  }, [selectedId]);

  useEffect(() => {
    setProfileDraft({
      name: publicProfile?.name || "",
      bio: publicProfile?.bio || "",
      address: publicProfile?.address || "",
      phone: publicProfile?.phone || "",
      websiteInstagram: publicProfile?.websiteInstagram || "",
      avatarUrl: publicProfile?.avatarUrl || "",
      onboardingCompleted: !!publicProfile?.onboardingCompleted,
    });
  }, [publicProfile]);

  useEffect(() => {
    setContactDraft({
      phone: publicContact?.phone || "",
      email: publicContact?.email || "",
      address: publicContact?.address || "",
    });
  }, [publicContact]);

  async function saveAdminMeta() {
    if (!selectedId) return;

    try {
      await updateDoc(doc(db, "users", selectedId), {
        role: roleDraft,
        riskLevel: riskDraft,
        labels: labelsDraft
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        adminNote: adminNoteDraft.trim(),
        blockListings: blockListingsDraft,
        blockMessages: blockMessagesDraft,
        updatedAt: serverTimestamp(),
        updatedBy: adminId || null,
      });

      showToast({ type: "success", text: "Admin alanları güncellendi." });
      await loadUsers();
    } catch (err) {
      devError("Admin user update error", err);
      showToast({ type: "error", text: "Güncelleme başarısız (rules kontrol et)." });
    }
  }

  async function saveBanSettings() {
    if (!selectedId) return;

    if (banMode === "temporary" && !banUntilDraft) {
      showToast({ type: "error", text: "Geçici ban için bitiş tarihi seç." });
      return;
    }

    const until = banMode === "temporary" ? fromLocalInputValue(banUntilDraft) : null;

    try {
      await updateDoc(doc(db, "users", selectedId), {
        banStatus: banMode,
        banUntil: until,
        banReason: banReasonDraft.trim(),
        banUpdatedAt: serverTimestamp(),
        banUpdatedBy: adminId || null,
      });

      showToast({ type: "success", text: "Ban ayarları güncellendi." });
      await loadUsers();
    } catch (err) {
      devError("Admin ban update error", err);
      showToast({ type: "error", text: "Ban güncellenemedi." });
    }
  }

  async function clearBan() {
    if (!selectedId) return;

    try {
      await updateDoc(doc(db, "users", selectedId), {
        banStatus: "none",
        banUntil: null,
        banReason: "",
        banUpdatedAt: serverTimestamp(),
        banUpdatedBy: adminId || null,
      });

      showToast({ type: "success", text: "Ban kaldırıldı." });
      setBanMode("none");
      setBanUntilDraft("");
      setBanReasonDraft("");
      await loadUsers();
    } catch (err) {
      devError("Admin ban remove error", err);
      showToast({ type: "error", text: "Ban kaldırma başarısız." });
    }
  }

  async function savePublicProfile() {
    if (!selectedId) return;

    try {
      const nextPhone = safeString(profileDraft.phone || "", "");
      const nextAddress = safeString(profileDraft.address || "", "");
      const nextWebsite = safeString(profileDraft.websiteInstagram || "", "");

      const nextShowPhone = !!publicProfile?.showPhone || !!nextPhone;
      const nextShowAddress = !!publicProfile?.showAddress || !!nextAddress;
      const nextShowWebsite =
        !!publicProfile?.showWebsiteInstagram || !!nextWebsite;

      await setDoc(
        doc(db, "publicProfiles", selectedId),
        {
          name: safeString(profileDraft.name || "", ""),
          bio: safeString(profileDraft.bio || "", ""),
          address: nextShowAddress ? nextAddress : "",
          phone: nextShowPhone ? nextPhone : "",
          websiteInstagram: nextShowWebsite ? nextWebsite : "",
          showPhone: nextShowPhone,
          showAddress: nextShowAddress,
          showWebsiteInstagram: nextShowWebsite,
          avatarUrl: safeString(profileDraft.avatarUrl || "", ""),
          onboardingCompleted: !!profileDraft.onboardingCompleted,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      showToast({ type: "success", text: "Profil bilgileri güncellendi." });
    } catch (err) {
      devError("Admin profile update error", err);
      showToast({ type: "error", text: "Profil güncellenemedi." });
    }
  }

  async function savePublicContact() {
    if (!selectedId) return;

    try {
      await setDoc(
        doc(db, "publicContacts", selectedId),
        {
          phone: safeString(contactDraft.phone || "", ""),
          email: safeString(contactDraft.email || "", ""),
          address: safeString(contactDraft.address || "", ""),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      showToast({ type: "success", text: "İletişim bilgileri güncellendi." });
    } catch (err) {
      devError("Admin contact update error", err);
      showToast({ type: "error", text: "İletişim bilgileri güncellenemedi." });
    }
  }

  async function loadConversationMessages(conversationId: string) {
    if (!conversationId) return;

    if (conversationMessagesLoading[conversationId]) return;
    setConversationMessagesLoading((prev) => ({ ...prev, [conversationId]: true }));

    try {
      const snap = await getDocs(
        query(
          collection(db, "conversations", conversationId, "messages"),
          orderBy("createdAt", "desc"),
          limit(30)
        )
      );

      const list = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .reverse();

      setConversationMessages((prev) => ({ ...prev, [conversationId]: list }));
    } catch (err) {
      devError("Admin messages load error", err);
      showToast({ type: "error", text: "Mesajlar yüklenemedi." });
    } finally {
      setConversationMessagesLoading((prev) => ({ ...prev, [conversationId]: false }));
    }
  }

  const filteredUsers = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return users.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;

      const banInfo = banState(u);
      if (banFilter === "banned" && !banInfo.active) return false;
      if (banFilter === "active" && banInfo.active) return false;

      if (!needle) return true;

      const blob = `${safeString(u.email, "")} ${u.id}`.toLowerCase();
      return blob.includes(needle);
    });
  }, [users, search, roleFilter, banFilter]);

  const selectedBan = banState(selectedUser);
  const tabs = [
    { id: "overview", label: "Genel Bakış" },
    { id: "moderation", label: "Moderasyon" },
    { id: "profile", label: "Profil" },
    { id: "contacts", label: "İletişim" },
    { id: "messages", label: "Mesajlar" },
  ] as const;

  return (
    <div className="space-y-4">
      <ToastView toast={toast} />

      <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)]">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
              Admin
            </div>
            <div className="mt-1 text-xl font-semibold text-slate-900">Kullanıcı Yönetimi</div>
            <div className="mt-1 text-sm text-slate-600">
              Kullanıcıları gör, filtrele, banla, düzenle ve mesajlara eriş.
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/admin/dashboard"
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white/80 hover:bg-slate-50 text-sm"
            >
              ← Kontrol Paneli
            </Link>
            <button
              type="button"
              onClick={loadUsers}
              className={cx(
                "px-3 py-2 rounded-xl bg-[#0f172a] text-white hover:bg-[#1f2937] text-sm",
                loading ? "opacity-60 pointer-events-none" : ""
              )}
            >
              ⟳ Yenile
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Email / UID ara"
            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm bg-white/90 outline-none focus:ring-2 focus:ring-slate-200"
          />

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as any)}
            className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white/90"
          >
            <option value="all">Tüm Roller</option>
            <option value="admin">Admin</option>
            <option value="user">User</option>
          </select>

          <select
            value={banFilter}
            onChange={(e) => setBanFilter(e.target.value as any)}
            className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white/90"
          >
            <option value="all">Tüm Durumlar</option>
            <option value="banned">Banlı</option>
            <option value="active">Aktif</option>
          </select>
        </div>

        <div className="mt-3 text-xs text-slate-500">
          Toplam: <span className="font-semibold text-slate-900">{users.length}</span> •
          Filtre: <span className="font-semibold text-slate-900">{filteredUsers.length}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4">
        <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-4 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)]">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-900">Kullanıcılar</div>
            {loading ? <div className="text-xs text-slate-500">Yükleniyor…</div> : null}
          </div>

          <div className="mt-3 space-y-2 max-h-[70vh] overflow-auto pr-1">
            {filteredUsers.length === 0 ? (
              <div className="text-sm text-slate-500 border border-slate-200/80 rounded-xl p-4 bg-slate-50">
                Sonuç bulunamadı.
              </div>
            ) : (
              filteredUsers.map((u) => {
                const isActive = selectedId === u.id;
                const banInfo = banState(u);
                const title = safeString(u.email, u.id);
                const subtitle = u.id;

                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setSelectedId(u.id)}
                    className={cx(
                      "w-full text-left border rounded-xl px-3 py-3 transition",
                      isActive
                        ? "border-[#0f172a] bg-[#0f172a]/5"
                        : "border-slate-200 hover:bg-slate-50"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center text-sm font-semibold">
                          {initialsFrom(title)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 truncate">
                            {title}
                          </div>
                          <div className="text-xs text-slate-500 truncate">{subtitle}</div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-[11px] px-2 py-1 rounded-full border border-slate-200 text-slate-600">
                          {u.role || "user"}
                        </span>
                        {banInfo.active && (
                          <span className="text-[11px] px-2 py-1 rounded-full border border-rose-200 bg-rose-50 text-rose-700">
                            Ban
                          </span>
                        )}
                        {u.blockListings && (
                          <span className="text-[11px] px-2 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                            Listing
                          </span>
                        )}
                        {u.blockMessages && (
                          <span className="text-[11px] px-2 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                            Mesaj
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-4">
          {!selectedUser ? (
            <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-6 text-slate-600">
              Kullanıcı seçilmedi.
            </div>
          ) : (
            <>
              <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)]">
                <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="h-14 w-14 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center text-lg font-semibold overflow-hidden">
                      {publicProfile?.avatarUrl ? (
                        <Image
                          src={publicProfile.avatarUrl}
                          alt=""
                          width={56}
                          height={56}
                          sizes="56px"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        initialsFrom(
                          safeString(publicProfile?.name, selectedUser.email || selectedUser.id)
                        )
                      )}
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                        Kullanıcı
                      </div>
                      <div className="mt-1 text-xl font-semibold text-slate-900">
                        {safeString(publicProfile?.name, selectedUser.email || selectedUser.id)}
                      </div>
                      <div className="mt-1 text-sm text-slate-600">
                        {safeString(selectedUser.email, "")}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab("moderation")}
                      className="px-3 py-2 rounded-xl border border-slate-200 bg-white/80 hover:bg-slate-50 text-sm"
                    >
                      Moderasyon
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("messages")}
                      className="px-3 py-2 rounded-xl border border-slate-200 bg-white/80 hover:bg-slate-50 text-sm"
                    >
                      Mesajlar
                    </button>
                    <Link
                      href={`/seller/${selectedUser.id}`}
                      className="px-3 py-2 rounded-xl border border-slate-200 bg-white/80 hover:bg-slate-50 text-sm"
                    >
                      Profili Aç
                    </Link>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(selectedUser.id)}
                      className="px-3 py-2 rounded-xl border border-slate-200 bg-white/80 hover:bg-slate-50 text-sm"
                    >
                      UID Kopyala
                    </button>
                    {selectedUser.email ? (
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(selectedUser.email || "")}
                        className="px-3 py-2 rounded-xl border border-slate-200 bg-white/80 hover:bg-slate-50 text-sm"
                      >
                        Email Kopyala
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-600">
                    Rol: <span className="font-semibold text-slate-800">{selectedUser.role || "user"}</span>
                  </span>
                  <span className="px-2.5 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-600">
                    Risk: <span className="font-semibold text-slate-800">{selectedUser.riskLevel || "low"}</span>
                  </span>
                  <span className="px-2.5 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-600">
                    İlan: <span className="font-semibold text-slate-800">{listingCount ?? "-"}</span>
                  </span>
                  <span className="px-2.5 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-600">
                    Sohbet: <span className="font-semibold text-slate-800">{conversationCount ?? "-"}</span>
                  </span>
                  <span
                    className={cx(
                      "px-2.5 py-1 rounded-full border text-xs",
                      selectedBan.active
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    )}
                  >
                    {selectedBan.active
                      ? selectedBan.mode === "permanent"
                        ? "Kalıcı Ban"
                        : "Geçici Ban"
                      : "Aktif"}
                  </span>
                  {selectedUser.blockListings && (
                    <span className="px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                      İlan kısıtı
                    </span>
                  )}
                  {selectedUser.blockMessages && (
                    <span className="px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                      Mesaj kısıtı
                    </span>
                  )}
                </div>
              </div>

              <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-3 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)]">
                <div className="flex flex-wrap gap-2">
                  {tabs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setActiveTab(t.id)}
                      className={cx(
                        "px-3 py-2 rounded-full border text-sm transition",
                        activeTab === t.id
                          ? "bg-[#0f172a] text-white border-[#0f172a]"
                          : "bg-white/80 text-slate-700 border-slate-200 hover:bg-slate-50"
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
              {activeTab === "moderation" && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)] space-y-4">
                  <div className="text-sm font-semibold text-slate-900">Moderasyon</div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="space-y-1">
                      <div className="text-xs text-slate-500">Rol</div>
                      <select
                        value={roleDraft}
                        onChange={(e) => setRoleDraft(e.target.value as any)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                    </label>

                    <label className="space-y-1">
                      <div className="text-xs text-slate-500">Risk</div>
                      <select
                        value={riskDraft}
                        onChange={(e) => setRiskDraft(e.target.value as any)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                      >
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                      </select>
                    </label>

                    <label className="space-y-1 md:col-span-2">
                      <div className="text-xs text-slate-500">Etiketler (virgülle)</div>
                      <input
                        value={labelsDraft}
                        onChange={(e) => setLabelsDraft(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                        placeholder="riskli, vip, manuel-izleme"
                      />
                    </label>

                    <label className="space-y-1 md:col-span-2">
                      <div className="text-xs text-slate-500">Admin Notu</div>
                      <textarea
                        value={adminNoteDraft}
                        onChange={(e) => setAdminNoteDraft(e.target.value)}
                        className="w-full min-h-[110px] border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                      />
                    </label>

                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={blockListingsDraft}
                          onChange={(e) => setBlockListingsDraft(e.target.checked)}
                        />
                        İlan kısıtı
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={blockMessagesDraft}
                          onChange={(e) => setBlockMessagesDraft(e.target.checked)}
                        />
                        Mesaj kısıtı
                      </label>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={saveAdminMeta}
                      className="px-4 py-2 rounded-xl bg-[#0f172a] text-white text-sm"
                    >
                      Kaydet
                    </button>
                    <span className="text-xs text-slate-500">
                      Kullanıcının rolünü ve risk etiketlerini günceller.
                    </span>
                  </div>
                </div>

                <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)] space-y-4">
                  <div className="text-sm font-semibold text-slate-900">Ban / Kısıt</div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <label className="space-y-1">
                      <div className="text-xs text-slate-500">Ban Tipi</div>
                      <select
                        value={banMode}
                        onChange={(e) => setBanMode(e.target.value as any)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                      >
                        <option value="none">Yok</option>
                        <option value="temporary">Geçici</option>
                        <option value="permanent">Kalıcı</option>
                      </select>
                    </label>

                    <label className="space-y-1">
                      <div className="text-xs text-slate-500">Bitiş</div>
                      <input
                        type="datetime-local"
                        value={banUntilDraft}
                        onChange={(e) => setBanUntilDraft(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                        disabled={banMode !== "temporary"}
                      />
                    </label>

                    <label className="space-y-1 md:col-span-1">
                      <div className="text-xs text-slate-500">Sebep</div>
                      <input
                        value={banReasonDraft}
                        onChange={(e) => setBanReasonDraft(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                        placeholder="Örn: dolandırıcılık"
                      />
                    </label>
                  </div>

                  <div className="text-xs text-slate-500">
                    Aktif ban: <span className="font-semibold">{selectedBan.active ? "Evet" : "Hayır"}</span>
                    {selectedBan.active && selectedBan.mode === "temporary" && selectedBan.untilMs ? (
                      <span> • Bitiş: {formatDateTR(selectedUser.banUntil)}</span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={saveBanSettings}
                      className="px-4 py-2 rounded-xl bg-rose-600 text-white text-sm hover:bg-rose-700"
                    >
                      Banı Uygula
                    </button>
                    <button
                      type="button"
                      onClick={clearBan}
                      className="px-4 py-2 rounded-xl border border-slate-200 text-sm"
                    >
                      Banı Kaldır
                    </button>
                  </div>
                </div>
              </div>
              )}

              {activeTab === "profile" && (
              <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)] space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">Profil Bilgileri</div>
                  {detailsLoading ? <div className="text-xs text-slate-500">Yükleniyor…</div> : null}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="space-y-1">
                    <div className="text-xs text-slate-500">Ad Soyad</div>
                    <input
                      value={profileDraft.name || ""}
                      onChange={(e) => setProfileDraft((p) => ({ ...p, name: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                    />
                  </label>

                  <label className="space-y-1">
                    <div className="text-xs text-slate-500">Telefon (public)</div>
                    <input
                      value={profileDraft.phone || ""}
                      onChange={(e) => setProfileDraft((p) => ({ ...p, phone: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                    />
                  </label>

                  <label className="space-y-1 md:col-span-2">
                    <div className="text-xs text-slate-500">Adres (public)</div>
                    <input
                      value={profileDraft.address || ""}
                      onChange={(e) => setProfileDraft((p) => ({ ...p, address: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                    />
                  </label>

                  <label className="space-y-1">
                    <div className="text-xs text-slate-500">Website / Instagram</div>
                    <input
                      value={profileDraft.websiteInstagram || ""}
                      onChange={(e) =>
                        setProfileDraft((p) => ({ ...p, websiteInstagram: e.target.value }))
                      }
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                    />
                  </label>

                  <label className="space-y-1">
                    <div className="text-xs text-slate-500">Avatar URL</div>
                    <input
                      value={profileDraft.avatarUrl || ""}
                      onChange={(e) => setProfileDraft((p) => ({ ...p, avatarUrl: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                    />
                  </label>

                  <label className="space-y-1 md:col-span-2">
                    <div className="text-xs text-slate-500">Bio</div>
                    <textarea
                      value={profileDraft.bio || ""}
                      onChange={(e) => setProfileDraft((p) => ({ ...p, bio: e.target.value }))}
                      className="w-full min-h-[120px] border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                    />
                  </label>

                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={!!profileDraft.onboardingCompleted}
                      onChange={(e) =>
                        setProfileDraft((p) => ({ ...p, onboardingCompleted: e.target.checked }))
                      }
                    />
                    Onboarding tamamlandı
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={savePublicProfile}
                    className="px-4 py-2 rounded-xl bg-[#0f172a] text-white text-sm"
                  >
                    Profili Kaydet
                  </button>
                  <span className="text-xs text-slate-500">
                    publicProfiles belgesini günceller.
                  </span>
                </div>
              </div>
              )}

              {activeTab === "contacts" && (
              <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)] space-y-4">
                <div className="text-sm font-semibold text-slate-900">İletişim (publicContacts)</div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <label className="space-y-1">
                    <div className="text-xs text-slate-500">Telefon</div>
                    <input
                      value={contactDraft.phone || ""}
                      onChange={(e) => setContactDraft((p) => ({ ...p, phone: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                    />
                  </label>

                  <label className="space-y-1">
                    <div className="text-xs text-slate-500">Email</div>
                    <input
                      value={contactDraft.email || ""}
                      onChange={(e) => setContactDraft((p) => ({ ...p, email: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                    />
                  </label>

                  <label className="space-y-1 md:col-span-3">
                    <div className="text-xs text-slate-500">Adres</div>
                    <input
                      value={contactDraft.address || ""}
                      onChange={(e) => setContactDraft((p) => ({ ...p, address: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                    />
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={savePublicContact}
                    className="px-4 py-2 rounded-xl bg-[#0f172a] text-white text-sm"
                  >
                    İletişimi Kaydet
                  </button>
                  <span className="text-xs text-slate-500">publicContacts belgesini günceller.</span>
                </div>
              </div>
              )}

              {activeTab === "overview" && (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-4 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)] space-y-2 text-sm">
                      <div>
                        <div className="text-xs text-slate-500">UID</div>
                        <div className="font-mono text-slate-800 break-all">{selectedUser.id}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Email</div>
                        <div className="text-slate-700 break-all">
                          {safeString(selectedUser.email, "-")}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Kayıt Tarihi</div>
                        <div className="text-slate-700">{formatDateTR(selectedUser.createdAt)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Provider</div>
                        <div className="text-slate-700">
                          {Array.isArray(selectedUser.provider) && selectedUser.provider.length > 0
                            ? selectedUser.provider.join(", ")
                            : "-"}
                        </div>
                      </div>
                    </div>

                    <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-4 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)] space-y-2 text-sm">
                      <div>
                        <div className="text-xs text-slate-500">Ban Durumu</div>
                        <div className="font-semibold text-slate-800">
                          {selectedBan.active
                            ? selectedBan.mode === "permanent"
                              ? "Kalıcı Ban"
                              : "Geçici Ban"
                            : "Aktif"}
                        </div>
                      </div>
                      {selectedBan.active && selectedBan.mode === "temporary" ? (
                        <div>
                          <div className="text-xs text-slate-500">Bitiş</div>
                          <div className="text-slate-700">
                            {selectedBan.untilMs ? formatDateTR(selectedUser.banUntil) : "-"}
                          </div>
                        </div>
                      ) : null}
                      <div>
                        <div className="text-xs text-slate-500">Sebep</div>
                        <div className="text-slate-700">{selectedUser.banReason || "-"}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Kısıtlar</div>
                        <div className="text-slate-700">
                          {selectedUser.blockListings || selectedUser.blockMessages
                            ? `${selectedUser.blockListings ? "İlan " : ""}${
                                selectedUser.blockMessages ? "Mesaj" : ""
                              }`
                            : "Yok"}
                        </div>
                      </div>
                    </div>

                    <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-4 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)] space-y-2 text-sm">
                      <div>
                        <div className="text-xs text-slate-500">Onboarding</div>
                        <div className="font-semibold text-slate-800">
                          {publicProfile?.onboardingCompleted ? "Tamamlandı" : "Eksik"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Risk</div>
                        <div className="font-semibold text-slate-800">
                          {selectedUser.riskLevel || "low"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Admin Notu</div>
                        <div className="text-slate-700">{selectedUser.adminNote || "—"}</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-4 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)]">
                      <div className="text-xs text-slate-500">İlan Sayısı</div>
                      <div className="mt-1 text-2xl font-semibold text-slate-900">
                        {listingCount ?? "-"}
                      </div>
                    </div>
                    <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-4 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)]">
                      <div className="text-xs text-slate-500">Sohbet Sayısı</div>
                      <div className="mt-1 text-2xl font-semibold text-slate-900">
                        {conversationCount ?? "-"}
                      </div>
                    </div>
                    <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-4 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)]">
                      <div className="text-xs text-slate-500">Mesaj</div>
                      <div className="mt-1 text-2xl font-semibold text-slate-900">—</div>
                    </div>
                  </div>
                </>
              )}

              {activeTab === "messages" && (
              <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)] space-y-4">
                <div className="text-sm font-semibold text-slate-900">Mesajlar / Sohbetler</div>

                {conversations.length === 0 ? (
                  <div className="border border-slate-200/80 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                    Bu kullanıcıya ait sohbet bulunamadı.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {conversations.map((c) => {
                      const listingTitle = safeString(c.listingSnapshot?.title, "İlan");
                      const last = c.lastMessage;
                      const lastText =
                        last?.type === "image"
                          ? "📷 Görsel"
                          : safeString(last?.text, "").slice(0, 80);
                      const isOpen = openConversationId === c.id;
                      const msgList = conversationMessages[c.id] || [];

                      return (
                        <div key={c.id} className="border border-slate-200/80 rounded-xl p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-900 truncate">
                                {listingTitle}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {lastText || "Mesaj yok"}
                              </div>
                              <div className="mt-1 text-[11px] text-slate-500">
                                {formatDateTR(c.lastMessageAt)}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const next = isOpen ? null : c.id;
                                  setOpenConversationId(next);
                                  if (next) loadConversationMessages(next);
                                }}
                                className="px-3 py-2 rounded-xl border border-slate-200 text-xs"
                              >
                                {isOpen ? "Kapat" : "Mesajları Gör"}
                              </button>
                              <button
                                type="button"
                                onClick={() => navigator.clipboard.writeText(c.id)}
                                className="px-3 py-2 rounded-xl border border-slate-200 text-xs"
                              >
                                ID Kopyala
                              </button>
                            </div>
                          </div>

                          {isOpen ? (
                            <div className="mt-3 border-t border-slate-200/70 pt-3">
                              {conversationMessagesLoading[c.id] ? (
                                <div className="text-xs text-slate-500">Yükleniyor…</div>
                              ) : msgList.length === 0 ? (
                                <div className="text-xs text-slate-500">Mesaj bulunamadı.</div>
                              ) : (
                                <div className="space-y-2">
                                  {msgList.map((m) => (
                                    <div
                                      key={m.id}
                                      className={cx(
                                        "text-xs rounded-lg px-3 py-2",
                                        m.senderId === selectedId
                                          ? "bg-slate-900 text-white"
                                          : "bg-slate-100 text-slate-700"
                                      )}
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-medium">
                                          {m.senderId === selectedId ? "Kullanıcı" : "Diğer"}
                                        </span>
                                        <span className="text-[10px] opacity-70">
                                          {formatDateTR(m.createdAt)}
                                        </span>
                                      </div>
                                      <div className="mt-1">
                                        {m.type === "image"
                                          ? "📷 Görsel"
                                          : safeString(m.text, "(mesaj)")}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              )}
            </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
