"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  doc,
  onSnapshot,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { getCategoriesCached } from "@/lib/catalogCache";
import { slugifyTR } from "@/lib/listingUrl";

/* ================= TYPES ================= */

type CategoryLike = {
  id: string;
  name: string;
  nameLower: string;
  slug?: string;
  parentId?: string | null;
  order?: number;
  enabled?: boolean;
};

type SubLike = {
  id: string;
  name: string;
  nameLower: string;
  slug?: string;
  parentId: string;
  order?: number;
  enabled?: boolean;
};

type HeaderCategoryInput = {
  id?: string;
  name?: string;
  nameLower?: string;
  slug?: string;
  parentId?: string | null;
  order?: number;
  enabled?: boolean;
};

type HeaderProps = {
  initialCategories?: HeaderCategoryInput[];
};

const buildCategoryState = (items: HeaderCategoryInput[]) => {
  const all = (items || [])
    .map((data) => ({
      id: String(data.id || ""),
      name: String(data.name || ""),
      nameLower: data.nameLower || slugifyTR(data.name || ""),
      slug: data.slug,
      parentId: data.parentId ?? null,
      order: data.order ?? 0,
      enabled: data.enabled,
    }))
    .filter((c) => c.id && c.name)
    .filter((c) => c.enabled !== false);

  const cArr = all.filter((c) => c.parentId == null);
  const subsAll: SubLike[] = all
    .filter((c) => c.parentId != null)
    .map((c) => ({
      id: c.id,
      name: c.name,
      nameLower: c.nameLower || slugifyTR(c.name || ""),
      slug: c.slug,
      parentId: c.parentId as string,
      order: c.order ?? 0,
      enabled: c.enabled,
    }));

  const map: Record<string, SubLike[]> = {};
  for (const s of subsAll) {
    if (!map[s.parentId]) map[s.parentId] = [];
    map[s.parentId].push(s);
  }

  const safeInt = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  Object.keys(map).forEach((k) => {
    map[k].sort((a, b) => {
      const oa = safeInt(a.order);
      const ob = safeInt(b.order);
      if (oa !== ob) return oa - ob;
      return (a.nameLower || "").localeCompare(b.nameLower || "");
    });
  });

  cArr.sort((a, b) => {
    const oa = safeInt(a.order);
    const ob = safeInt(b.order);
    if (oa !== ob) return oa - ob;
    return (a.nameLower || "").localeCompare(b.nameLower || "");
  });

  return {
    cats: cArr,
    subsMap: map,
    firstId: cArr[0]?.id || null,
  };
};

type UserUnreadDoc = {
  unreadCount?: number;
  role?: string;
};

type PublicBrandingDoc = {
  siteName?: string;
  brandLogoUrl?: string;
};

/* ================= HELPERS ================= */

function cx(...arr: Array<string | false | null | undefined>) {
  return arr.filter(Boolean).join(" ");
}

function normalizeQuery(s: string) {
  return s.trim().replace(/\s+/g, " ");
}

function safeSlug(obj: { slug?: string; nameLower?: string; name?: string }) {
  const raw =
    (obj.slug && obj.slug.trim()) ||
    obj.nameLower ||
    obj.name ||
    "";
  return slugifyTR(raw);
}


/**
 * Header:
 * - Mobile: Portal full-screen drawer ✅
 * - Desktop: Mega menu (Kategori -> Alt kategori) ✅
 *
 * Data source:
 * - 먼저 categories/subCategories dener
 * - categories/subCategories kullanilir
 *
 * Route:
 * - category: /{categorySlug}
 * - sub:      /{categorySlug}/{subSlug}
 */
export default function Header({ initialCategories = [] }: HeaderProps) {
  const router = useRouter();
  const headerRef = useRef<HTMLDivElement>(null);
  const mobileSearchRef = useRef<HTMLDivElement>(null);
  const mobileSearchButtonRef = useRef<HTMLButtonElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);

  const [user, setUser] = useState<User | null>(null);

  // Desktop menus
  const [desktopMegaOpen, setDesktopMegaOpen] = useState(false);

  // Mobile drawer
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  // Search
  const [searchText, setSearchText] = useState("");

  // Unread
  const [unreadTotal, setUnreadTotal] = useState(0);
  const adminSessionRequested = useRef(false);

  // Categories + Subs
  const initialState = buildCategoryState(initialCategories);
  const [cats, setCats] = useState<CategoryLike[]>(initialState.cats);
  const [subsMap, setSubsMap] = useState<Record<string, SubLike[]>>(
    initialState.subsMap
  );
  const [catsLoading, setCatsLoading] = useState(
    initialCategories.length === 0
  );

  // Branding
  const [siteName, setSiteName] = useState("KURMAY");
  const [brandLogoUrl, setBrandLogoUrl] = useState("");

  // Desktop selected category
  const [desktopActiveCatId, setDesktopActiveCatId] = useState<string | null>(
    initialState.firstId
  );

  // Mobile accordion open category
  const [catOpenId, setCatOpenId] = useState<string | null>(null);

  const isSignedIn = !!user;
  const canUseDOM = typeof document !== "undefined";
  const displayUnreadTotal = user ? unreadTotal : 0;

  const desktopActiveCat = useMemo(() => {
    if (!desktopActiveCatId) return null;
    return cats.find((c) => c.id === desktopActiveCatId) || null;
  }, [cats, desktopActiveCatId]);

  const desktopActiveSubs = useMemo(() => {
    if (!desktopActiveCatId) return [];
    return subsMap[desktopActiveCatId] || [];
  }, [subsMap, desktopActiveCatId]);

  const ensureDesktopActive = () => {
    if (!cats.length) return;
    if (!desktopActiveCatId || !cats.find((c) => c.id === desktopActiveCatId)) {
      setDesktopActiveCatId(cats[0].id);
    }
  };

  /* ================= AUTH ================= */

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  /* ================= BRAND SETTINGS ================= */

  useEffect(() => {
    if (!db) return;
    const unsub = onSnapshot(
      doc(db, "publicSettings", "global"),
      (snap) => {
        if (!snap.exists()) {
          setSiteName("KURMAY");
          setBrandLogoUrl("");
          return;
        }
        const d = snap.data() as PublicBrandingDoc;
        setSiteName((d.siteName || "KURMAY").toString());
        setBrandLogoUrl((d.brandLogoUrl || "").toString());
      },
      () => {
        // If client cannot read admin settings by rules, keep safe defaults.
        setSiteName("KURMAY");
        setBrandLogoUrl("");
      }
    );
    return () => unsub();
  }, []);

  /* ================= BODY SCROLL LOCK (MOBILE) ================= */

  useEffect(() => {
    if (!mobileOpen) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileOpen]);

  /* ================= HEADER HEIGHT VAR ================= */

  useEffect(() => {
    if (!headerRef.current) return;

    const updateHeight = () => {
      const h = headerRef.current!.offsetHeight;
      document.documentElement.style.setProperty("--app-header-height", `${h}px`);
    };

    updateHeight();

    const ro = new ResizeObserver(updateHeight);
    ro.observe(headerRef.current);

    return () => ro.disconnect();
  }, []);

  /* ================= CLICK OUTSIDE (DESKTOP MENUS) ================= */

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (headerRef.current && !headerRef.current.contains(t)) {
        setDesktopMegaOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  /* ================= MOBILE SEARCH ================= */

  useEffect(() => {
    if (!mobileSearchOpen) return;
    const id = window.setTimeout(() => {
      mobileSearchInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [mobileSearchOpen]);

  useEffect(() => {
    if (!mobileSearchOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (
        mobileSearchRef.current?.contains(t) ||
        mobileSearchButtonRef.current?.contains(t)
      ) {
        return;
      }
      setMobileSearchOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [mobileSearchOpen]);

  /* ================= LOAD CATEGORIES ================= */

  useEffect(() => {
    if (initialCategories.length > 0) return;
    let cancelled = false;

    async function loadData() {
      setCatsLoading(true);

      try {
        const cached = await getCategoriesCached();

        const all: CategoryLike[] = cached
          .map((data: any) => ({
            id: data.id,
            name: data.name,
            nameLower: data.nameLower,
            slug: data.slug,
            parentId: data.parentId ?? null,
            order: data.order ?? 0,
            enabled: data.enabled,
          }))
          .filter((c) => c.enabled !== false);

        const cArr = all.filter((c) => c.parentId == null);

        const subsAll: SubLike[] = all
          .filter((c) => c.parentId != null)
          .map((c) => ({
            id: c.id,
            name: c.name,
            nameLower: c.nameLower,
            slug: c.slug,
            parentId: c.parentId as string,
            order: c.order ?? 0,
            enabled: c.enabled,
          }));

        const map: Record<string, SubLike[]> = {};
        for (const s of subsAll) {
          if (!map[s.parentId]) map[s.parentId] = [];
          map[s.parentId].push(s);
        }

        const safeInt = (v: any) =>
          Number.isFinite(Number(v)) ? Number(v) : 0;

        Object.keys(map).forEach((k) => {
          map[k].sort((a, b) => {
            const oa = safeInt(a.order);
            const ob = safeInt(b.order);
            if (oa !== ob) return oa - ob;
            return (a.nameLower || "").localeCompare(b.nameLower || "");
          });
        });

        cArr.sort((a, b) => {
          const oa = safeInt(a.order);
          const ob = safeInt(b.order);
          if (oa !== ob) return oa - ob;
          return (a.nameLower || "").localeCompare(b.nameLower || "");
        });

        if (!cancelled) {
          setCats(cArr);
          setSubsMap(map);

          const firstId = cArr[0]?.id || null;
          setDesktopActiveCatId(firstId);
          setCatOpenId(null);

          setCatsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setCats([]);
          setSubsMap({});
          setDesktopActiveCatId(null);
          setCatOpenId(null);
          setCatsLoading(false);
        }
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, [initialCategories.length]);

  /* ================= UNREAD ================= */

  useEffect(() => {
    if (!user) return;

    const ref = doc(db, "users", user.uid);
    const unsub = onSnapshot(
      ref,
      async (snap) => {
        if (!snap.exists()) {
          setUnreadTotal(0);
          return;
        }
        const data = snap.data() as UserUnreadDoc;
        const total = typeof data?.unreadCount === "number" ? data.unreadCount : 0;
        setUnreadTotal(total);

        if (data?.role === "admin" && !adminSessionRequested.current) {
          adminSessionRequested.current = true;
          try {
            const token = await user.getIdToken();
            await fetch("/api/admin/session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ idToken: token }),
            });
          } catch {
            // ignore
          }
        }
      },
      () => {
        // ignore unread errors to avoid breaking header
      }
    );

    return () => unsub();
  }, [user]);

  /* ================= ACTIONS ================= */

  const closeDesktopMenus = () => {
    setDesktopMegaOpen(false);
  };

  const closeAllMenus = () => {
    closeDesktopMenus();
    setMobileOpen(false);
    setMobileSearchOpen(false);
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/admin/session", { method: "DELETE" });
    } catch {
      // ignore
    }
    adminSessionRequested.current = false;
    await signOut(auth);
    closeAllMenus();
    router.push("/login");
  };

  const submitSearch = () => {
    const q = normalizeQuery(searchText);
    if (!q) return;
    closeAllMenus();
    router.push(`/?q=${encodeURIComponent(q)}`);
  };

  const goCategory = (cat: CategoryLike) => {
    const catSlug = safeSlug(cat);
    if (!catSlug) return;
    closeAllMenus();
    router.push(`/${catSlug}`);
  };

  const goSub = (cat: CategoryLike, sub: SubLike) => {
    const catSlug = safeSlug(cat);
    const subSlug = safeSlug(sub);
    if (!catSlug || !subSlug) return;
    closeAllMenus();
    router.push(`/${catSlug}/${subSlug}`);
  };

  /* ================= MOBILE DRAWER (PORTAL) ================= */

  const mobileDrawer = mobileOpen ? (
      <div className="fixed inset-0 z-[9999]">
        <div
          className="absolute inset-0 bg-black/40"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />

        <div className="absolute inset-0 w-screen h-[100dvh] bg-[#fffaf3] flex flex-col">
          <div className="px-4 py-3 border-b border-[#f0e2d1] flex items-center justify-between">
            <div className="flex items-center gap-2 text-lg font-semibold text-[#3f2a1a]">
              {brandLogoUrl ? (
                <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-full overflow-hidden border border-[#1f2a24]/10 bg-white">
                  <Image
                    src={brandLogoUrl}
                    alt={`${siteName || "KURMAY"} logo`}
                    fill
                    sizes="32px"
                    className="object-cover"
                  />
                </span>
              ) : (
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#1f2a24] text-xs font-bold text-white">
                  K
                </span>
              )}
              {siteName || "KURMAY"}
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              className="w-10 h-10 rounded-full hover:bg-[#f7ede2] flex items-center justify-center"
              aria-label="Kapat"
            >
              <svg
                className="w-6 h-6 text-[#5a4330]"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div className="px-4 pt-3 pb-2">
            <div className="relative">
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitSearch()}
                placeholder="Ürün, oyun, figür, kart..."
                className={cx(
                  "w-full rounded-full border border-[#ead8c5] bg-white/70 px-4 py-3 pr-12 text-sm text-[#3f2a1a] placeholder:text-[#9b7b5a]",
                  "focus:outline-none focus:ring-2 focus:ring-[#e7c49b] focus:border-[#d9b28a]"
                )}
              />
              <button
                onClick={submitSearch}
                aria-label="Ara"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full hover:bg-[#f7ede2] flex items-center justify-center"
              >
                <svg
                  className="w-5 h-5 text-[#5a4330]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-4.3-4.3m1.8-5.2a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-8 pt-2">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Link
                  href="/"
                  onClick={() => setMobileOpen(false)}
                  className="flex-1 rounded-2xl border border-[#1f2a24] bg-white/90 py-2 text-center text-[11px] font-semibold text-[#1f2a1a] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#1f2a24] hover:text-white"
                >
                  <div className="flex flex-col items-center gap-1">
                    <svg
                      className="w-4 h-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 10.5L12 3l9 7.5V21a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1v-10.5z"
                      />
                    </svg>
                    Ana Sayfa
                  </div>
                </Link>

                <Link
                  href={isSignedIn ? "/my/messages" : "/login"}
                  onClick={() => setMobileOpen(false)}
                  className="flex-1 rounded-2xl border border-[#1f2a24] bg-white/90 py-2 text-center text-[11px] font-semibold text-[#1f2a1a] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#1f2a24] hover:text-white relative"
                >
                  <div className="flex flex-col items-center gap-1">
                    <svg
                      className="w-4 h-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
                      />
                    </svg>
                    Mesajlar
                  </div>
                  {isSignedIn && displayUnreadTotal > 0 && (
                    <span className="absolute -top-1 -right-1 inline-flex min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] items-center justify-center">
                      {displayUnreadTotal > 99 ? "99+" : displayUnreadTotal}
                    </span>
                  )}
                </Link>

                <Link
                  href={isSignedIn ? "/my" : "/login"}
                  onClick={() => setMobileOpen(false)}
                  className="flex-1 rounded-2xl border border-[#1f2a24] bg-white/90 py-2 text-center text-[11px] font-semibold text-[#1f2a1a] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#1f2a24] hover:text-white"
                >
                  <div className="flex flex-col items-center gap-1">
                    <svg
                      className="w-4 h-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z"
                      />
                    </svg>
                    Hesabım
                  </div>
                </Link>
              </div>

              <Link
                href="/harita"
                onClick={() => setMobileOpen(false)}
                className="w-full px-4 py-3 rounded-full border border-[#1f2a24] bg-white/90 text-sm font-semibold text-[#1f2a1a] inline-flex items-center justify-center gap-2 text-center transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#1f2a24] hover:text-white"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 22s7-5.33 7-11a7 7 0 10-14 0c0 5.67 7 11 7 11z"
                  />
                  <circle cx="12" cy="11" r="2.5" />
                </svg>
                Harita
              </Link>

              <Link
                href="/new"
                onClick={() => setMobileOpen(false)}
                className="w-full px-4 py-3 rounded-full border border-[#1f2a24] bg-[#1f2a24] text-white text-sm font-bold shadow-sm inline-flex items-center justify-center gap-2 text-center transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#2b3b32] hover:shadow-md"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                </svg>
                Ürün Sat / İlan Ver
              </Link>

              {!isSignedIn && (
                <Link
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                  className="w-full px-4 py-3 rounded-full border border-[#1f2a24] bg-white/90 text-sm font-bold text-[#1f2a1a] shadow-sm inline-flex items-center justify-center gap-2 text-center transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#1f2a24] hover:text-white hover:shadow-md"
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M11 16l-4-4m0 0l4-4m-4 4h14M21 21V3"
                    />
                  </svg>
                  Giriş Yap
                </Link>
              )}
            </div>
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wide text-[#9f6b3b] mb-2">
                Kategoriler
              </div>

              {catsLoading ? (
                <div className="space-y-2">
                  <div className="h-12 bg-[#f3e7d8] rounded-2xl animate-pulse" />
                  <div className="h-12 bg-[#f3e7d8] rounded-2xl animate-pulse" />
                  <div className="h-12 bg-[#f3e7d8] rounded-2xl animate-pulse" />
                </div>
              ) : cats.length === 0 ? (
                <div className="text-sm text-[#8b6b52] px-1">
                  Henüz kategori yok.
                </div>
              ) : (
                <div className="space-y-2">
                  {cats.map((c) => {
                    const open = catOpenId === c.id;
                    const subs = subsMap[c.id] || [];
                    return (
                      <div
                        key={c.id}
                        className={cx(
                          "rounded-2xl border border-[#ead8c5] bg-white/80 overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
                          open && "ring-2 ring-[#e7c49b] border-[#e0c4a2] shadow-sm"
                        )}
                      >
                        <div className="flex items-center justify-between px-4 py-3">
                          <button
                            onClick={() => goCategory(c)}
                            className="text-sm font-semibold text-[#3f2a1a] hover:text-[#6b3c19] transition text-left"
                          >
                            {c.name}
                          </button>
                          <button
                            onClick={() => {
                              const nextOpen = open ? null : c.id;
                              setCatOpenId(nextOpen);
                            }}
                            className={cx(
                              "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ring-1",
                              open
                                ? "bg-[#1f2a24] text-white shadow-md ring-[#e7c49b]"
                                : "bg-white text-[#3f2a1a] hover:bg-[#f7ede2] hover:-translate-y-0.5 ring-[#ead8c5]"
                            )}
                            aria-label="Alt kategoriler"
                          >
                            <span className="text-xl font-semibold leading-none">
                              {open ? "−" : "+"}
                            </span>
                          </button>
                        </div>

                        {open && (
                          <div className="border-t border-[#ead8c5] bg-[#fff7ed]">
                            <button
                              onClick={() => goCategory(c)}
                              className="w-full text-left px-4 py-2 text-sm font-semibold text-[#6b3c19] hover:bg-[#f7ede2] transition"
                            >
                              {c.name} → Tümü
                            </button>

                            {subs.length === 0 ? (
                              <div className="px-4 py-2 text-sm text-[#8b6b52]">
                                Alt kategori yok.
                              </div>
                            ) : (
                              <div className="p-2">
                                {subs.map((s) => {
                                  return (
                                    <button
                                      key={s.id}
                                      onClick={() => goSub(c, s)}
                                      className="w-full text-left px-3 py-2 rounded-xl text-sm hover:bg-[#f7ede2] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
                                    >
                                      <span>{s.name}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {isSignedIn && (
              <div className="mt-6">
                <button
                  onClick={handleLogout}
                  className="w-full px-4 py-3 rounded-full border border-[#a03a2e] bg-[#a03a2e] text-white text-sm font-bold shadow-sm inline-flex items-center justify-center gap-2 transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#8f2f25] hover:shadow-md"
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 12H3m0 0l4-4m-4 4l4 4M21 21V3"
                    />
                  </svg>
                  Çıkış Yap
                </button>
              </div>
            )}
          </div>

          <div className="h-2" />
        </div>
      </div>
  ) : null;

  /* ================= DESKTOP MEGA MENU ================= */

  const desktopMegaMenu = desktopMegaOpen ? (
    <div className="absolute left-0 top-full mt-3 bg-[#fffaf3] border border-[#ead8c5] shadow-[0_30px_80px_-40px_rgba(15,23,42,0.45)] rounded-2xl overflow-hidden w-[720px]">
      <div className="grid grid-cols-2">
        {/* left: categories */}
        <div className="p-5 border-r border-[#ead8c5]">
          <div className="text-xs uppercase tracking-wide text-[#9f6b3b] mb-3">
            Kategoriler
          </div>

          {catsLoading ? (
            <div className="space-y-2">
              <div className="h-9 bg-[#f3e7d8] rounded-xl animate-pulse" />
              <div className="h-9 bg-[#f3e7d8] rounded-xl animate-pulse" />
              <div className="h-9 bg-[#f3e7d8] rounded-xl animate-pulse" />
            </div>
          ) : cats.length === 0 ? (
            <div className="text-sm text-[#9b7b5a]">Kategori yok</div>
          ) : (
            <ul className="space-y-1 max-h-[360px] overflow-auto pr-1">
              {cats.map((c) => {
                const active = c.id === desktopActiveCatId;
                return (
                  <li key={c.id}>
                    <button
                      onMouseEnter={() => setDesktopActiveCatId(c.id)}
                      onFocus={() => setDesktopActiveCatId(c.id)}
                      onClick={() => goCategory(c)}
                      className={cx(
                        "w-full text-left px-3 py-2 rounded-xl text-sm transition",
                        active
                          ? "bg-[#f7ede2] text-[#6b3c19] font-semibold"
                          : "hover:bg-[#f7ede2] text-[#3f2a1a]"
                      )}
                    >
                      {c.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* right: sub categories */}
        <div className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-wide text-[#9f6b3b]">
              Alt Kategoriler
            </div>

            {desktopActiveCat && (
              <button
                onClick={() => goCategory(desktopActiveCat)}
                className="text-xs text-[#6b3c19] hover:text-[#4f2c11] font-semibold"
              >
                {desktopActiveCat.name} → Tümü
              </button>
            )}
          </div>

          {!desktopActiveCat ? (
            <div className="text-sm text-[#9b7b5a]">Kategori seç</div>
          ) : desktopActiveSubs.length === 0 ? (
            <div className="text-sm text-[#9b7b5a]">Alt kategori yok</div>
          ) : (
            <div className="grid grid-cols-1 gap-1 max-h-[360px] overflow-auto pr-1">
              {desktopActiveSubs.map((s) => {
                return (
                  <button
                    key={s.id}
                    onClick={() => goSub(desktopActiveCat, s)}
                    className="text-left text-sm px-3 py-2 rounded-xl hover:bg-[#f7ede2] transition"
                  >
                    <span>{s.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="px-5 py-3 border-t border-[#ead8c5] bg-[#fff1e4] text-xs text-[#8b6b52]">
        İpucu: Kategori seç → Alt kategori seç.
      </div>
    </div>
  ) : null;

  /* ================= RENDER ================= */

  return (
    <>
      <header
        ref={headerRef}
        className="sticky top-0 z-50 w-full bg-[#fffaf3]/90 backdrop-blur border-b border-[#f0e2d1] shadow-[0_8px_20px_-12px_rgba(15,23,42,0.35)]"
      >
        <div className="w-full px-6 py-3.5 flex items-center justify-between gap-3">
          {/* LEFT */}
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-2 text-lg sm:text-xl font-semibold tracking-tight text-[#3f2a1a]"
            >
              {brandLogoUrl ? (
                <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-2xl overflow-hidden border border-[#1f2a24]/10 bg-white shadow-sm">
                  <Image
                    src={brandLogoUrl}
                    alt={`${siteName || "KURMAY"} logo`}
                    fill
                    sizes="36px"
                    className="object-cover"
                  />
                </span>
              ) : (
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-[#1f2a24] text-xs font-bold text-white shadow-sm">
                  K
                </span>
              )}
              {siteName || "KURMAY"}
            </Link>

            {/* DESKTOP: Categories mega */}
            <div className="hidden md:block relative">
              <button
                onClick={() => {
                  setDesktopMegaOpen((p) => {
                    const next = !p;
                    if (next) ensureDesktopActive();
                    return next;
                  });
                }}
                className={cx(
                  "px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200 inline-flex items-center gap-2 border border-[#1f2a24] shadow-sm",
                  desktopMegaOpen
                    ? "bg-[#1f2a24] text-white"
                    : "bg-white/90 text-[#1f2a24] hover:-translate-y-0.5 hover:bg-[#1f2a24] hover:text-white hover:shadow-md"
                )}
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 6h7v7H4zM13 6h7v7h-7zM4 15h7v5H4zM13 15h7v5h-7z"
                  />
                </svg>
                Kategoriler
              </button>

              {desktopMegaMenu}
            </div>
          </div>

          {/* CENTER: Desktop search */}
          <div className="hidden md:flex flex-1 max-w-xs md:max-w-md min-w-0">
            <div className="w-full relative">
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitSearch()}
                placeholder="Ürün, oyun, figür, kart..."
                className={cx(
                  "w-full rounded-full border border-[#ead8c5] bg-white/70 px-3 sm:px-4 py-2 pr-9 sm:pr-10 text-xs sm:text-sm text-[#3f2a1a] placeholder:text-[#9b7b5a]",
                  "focus:outline-none focus:ring-2 focus:ring-[#e7c49b] focus:border-[#d9b28a]"
                )}
              />
              <button
                onClick={submitSearch}
                aria-label="Ara"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full hover:bg-[#f7ede2] flex items-center justify-center"
              >
                <svg
                  className="w-4 h-4 sm:w-5 sm:h-5 text-[#5a4330]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-4.3-4.3m1.8-5.2a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* MOBILE: Harita button */}
          <div className="md:hidden flex-1 flex justify-center">
            <Link
              href="/harita"
              className="px-3 py-2 rounded-full text-xs font-semibold inline-flex items-center gap-2 border border-[#1f2a24] shadow-sm transition-all duration-200 bg-white/90 text-[#1f2a24] hover:-translate-y-0.5 hover:bg-[#1f2a24] hover:text-white hover:shadow-md"
              aria-label="Harita"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 22s7-5.33 7-11a7 7 0 10-14 0c0 5.67 7 11 7 11z"
                />
                <circle cx="12" cy="11" r="2.5" />
              </svg>
              Harita
            </Link>
          </div>

          {/* RIGHT */}
          <div className="flex items-center gap-2">
            {/* DESKTOP: actions in order */}
            <div className="hidden md:flex items-center gap-2">
              <Link
                href="/new"
                className="px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200 inline-flex items-center gap-2 border border-[#1f2a24] bg-[#1f2a24] text-white shadow-sm hover:-translate-y-0.5 hover:bg-[#2b3b32] hover:shadow-md"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                </svg>
                + İlan Ver
              </Link>

              <Link
                href="/harita"
                className="px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200 inline-flex items-center gap-2 border border-[#1f2a24] bg-white/90 text-[#1f2a24] shadow-sm hover:-translate-y-0.5 hover:bg-[#1f2a24] hover:text-white hover:shadow-md"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 22s7-5.33 7-11a7 7 0 10-14 0c0 5.67 7 11 7 11z"
                  />
                  <circle cx="12" cy="11" r="2.5" />
                </svg>
                Harita
              </Link>

              <Link
                href="/my/messages"
                className="relative px-3 py-2 rounded-full text-sm font-semibold text-[#3f2a1a] hover:bg-[#f7ede2] inline-flex items-center gap-2"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
                  />
                </svg>
                Mesajlar
                {isSignedIn && displayUnreadTotal > 0 && (
                  <span
                    className={cx(
                      "absolute -top-1 -right-1",
                      "min-w-[18px] h-[18px] px-1",
                      "rounded-full bg-red-500 text-white text-[10px]",
                      "flex items-center justify-center",
                      "shadow-sm ring-2 ring-white"
                    )}
                    aria-label={`${displayUnreadTotal} okunmamış mesaj`}
                  >
                    {displayUnreadTotal > 99 ? "99+" : displayUnreadTotal}
                  </span>
                )}
              </Link>

              <Link
                href="/my"
                className="px-3 py-2 rounded-full text-sm font-semibold text-[#3f2a1a] hover:bg-[#f7ede2] inline-flex items-center gap-2"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z"
                  />
                </svg>
                Hesabım
              </Link>

              {isSignedIn ? (
                <button
                  onClick={handleLogout}
                  className="px-3 py-2 rounded-full text-sm font-semibold text-[#a03a2e] hover:bg-[#fdeeee] inline-flex items-center gap-2"
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 12H3m0 0l4-4m-4 4l4 4M21 21V3"
                    />
                  </svg>
                  Çıkış Yap
                </button>
              ) : (
                <Link
                  href="/login"
                  className="px-3 py-2 rounded-full text-sm font-semibold text-[#3f2a1a] hover:bg-[#f7ede2] inline-flex items-center gap-2"
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M11 16l-4-4m0 0l4-4m-4 4h14M21 21V3"
                    />
                  </svg>
                  Giriş Yap
                </Link>
              )}

            </div>

            {/* MOBILE quick actions */}
            <div className="md:hidden flex items-center gap-2">
              <Link
                href="/new"
                className="px-3 py-2 rounded-full bg-[#1f2a24] hover:bg-[#2b3b32] text-white text-xs font-semibold inline-flex items-center gap-1"
              >
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
                </svg>
                İlan
              </Link>
            </div>

            {/* MOBILE hamburger */}
            <button
              onClick={() => {
                setCatOpenId(null);
                setMobileSearchOpen(false);
                setMobileOpen(true);
              }}
              className="md:hidden w-10 h-10 rounded-full hover:bg-[#f7ede2] flex items-center justify-center"
              aria-label="Menü"
            >
              <svg
                className="w-6 h-6 text-[#5a4330]"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          </div>
        </div>

        {mobileSearchOpen && (
          <div ref={mobileSearchRef} className="md:hidden px-4 pb-3">
            <div className="relative">
              <input
                ref={mobileSearchInputRef}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitSearch()}
                placeholder="Ürün, oyun, figür, kart..."
                className={cx(
                  "w-full rounded-full border border-[#ead8c5] bg-white/90 px-4 py-3 pr-12 text-sm text-[#3f2a1a] placeholder:text-[#9b7b5a]",
                  "focus:outline-none focus:ring-2 focus:ring-[#e7c49b] focus:border-[#d9b28a]"
                )}
              />
              <button
                onClick={submitSearch}
                aria-label="Ara"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full hover:bg-[#f7ede2] flex items-center justify-center"
              >
                <svg
                  className="w-5 h-5 text-[#5a4330]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-4.3-4.3m1.8-5.2a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ✅ Portal drawer */}
      {canUseDOM && mobileDrawer ? createPortal(mobileDrawer, document.body) : null}
    </>
  );
}
