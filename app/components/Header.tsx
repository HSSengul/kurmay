"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

  const [user, setUser] = useState<User | null>(null);

  // Desktop menus
  const [desktopMegaOpen, setDesktopMegaOpen] = useState(false);

  // Mobile drawer
  const [mobileOpen, setMobileOpen] = useState(false);

  // Search
  const [searchText, setSearchText] = useState("");

  // Unread
  const [unreadTotal, setUnreadTotal] = useState(0);

  // Categories + Subs
  const initialState = buildCategoryState(initialCategories);
  const [cats, setCats] = useState<CategoryLike[]>(initialState.cats);
  const [subsMap, setSubsMap] = useState<Record<string, SubLike[]>>(
    initialState.subsMap
  );
  const [catsLoading, setCatsLoading] = useState(
    initialCategories.length === 0
  );

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
      (snap) => {
        if (!snap.exists()) {
          setUnreadTotal(0);
          return;
        }
        const data = snap.data() as UserUnreadDoc;
        const total = typeof data?.unreadCount === "number" ? data.unreadCount : 0;
        setUnreadTotal(total);
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
  };

  const handleLogout = async () => {
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
            <div className="text-lg font-semibold text-[#3f2a1a]">İlanSitesi</div>
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
            <div
              className={cx(
                "grid gap-2",
                isSignedIn ? "grid-cols-3" : "grid-cols-2"
              )}
            >
              <Link
                href="/"
                onClick={() => setMobileOpen(false)}
                className="w-full px-3 py-2.5 rounded-full border border-[#ead8c5] bg-white/80 hover:bg-[#f7ede2] text-sm font-semibold text-[#3f2a1a] flex items-center justify-center text-center"
              >
                Ana Sayfa
              </Link>

              {isSignedIn && (
                <Link
                  href="/my/messages"
                  onClick={() => setMobileOpen(false)}
                  className="w-full px-3 py-2.5 rounded-full border border-[#ead8c5] bg-white/80 hover:bg-[#f7ede2] text-sm font-semibold text-[#3f2a1a] flex items-center justify-center text-center relative"
                >
                  Mesajlar
                  {displayUnreadTotal > 0 && (
                    <span className="absolute -top-1 -right-1 inline-flex min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] items-center justify-center">
                      {displayUnreadTotal > 99 ? "99+" : displayUnreadTotal}
                    </span>
                  )}
                </Link>
              )}

              {isSignedIn && (
                <Link
                  href="/my"
                  onClick={() => setMobileOpen(false)}
                  className="w-full px-3 py-2.5 rounded-full border border-[#ead8c5] bg-white/80 hover:bg-[#f7ede2] text-sm font-semibold text-[#3f2a1a] flex items-center justify-center text-center"
                >
                  Hesabım
                </Link>
              )}

              {!isSignedIn && (
                <Link
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                  className="w-full px-3 py-2.5 rounded-full bg-[#1f2a24] hover:bg-[#2b3b32] text-white text-sm font-bold shadow-sm flex items-center justify-center text-center"
                >
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
                          "rounded-2xl border border-[#ead8c5] bg-white/80 overflow-hidden transition",
                          open && "ring-2 ring-[#e7c49b] border-[#e0c4a2]"
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
                              "w-10 h-10 rounded-full flex items-center justify-center transition ring-1",
                              open
                                ? "bg-[#1f2a24] text-white shadow-md ring-[#e7c49b]"
                                : "bg-white text-[#3f2a1a] hover:bg-[#f7ede2] ring-[#ead8c5]"
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
                                      className="w-full text-left px-3 py-2 rounded-xl text-sm hover:bg-[#f7ede2] transition"
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

            <div className="mt-6">
              <Link
                href="/new"
                onClick={() => setMobileOpen(false)}
                className="block px-4 py-3 rounded-full bg-[#1f2a24] hover:bg-[#2b3b32] text-white text-sm font-bold shadow-sm text-center"
              >
                + Ürün Sat / İlan Ver
              </Link>
            </div>

            {isSignedIn && (
              <div className="mt-6">
                <button
                  onClick={handleLogout}
                  className="w-full px-4 py-3 rounded-full bg-[#a03a2e] hover:bg-[#8f2f25] text-white text-sm font-bold shadow-sm"
                >
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
        <div className="max-w-6xl mx-auto px-4 py-3.5 flex items-center justify-between gap-3">
          {/* LEFT */}
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-2 text-lg sm:text-xl font-semibold tracking-tight text-[#3f2a1a]"
            >
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[#caa07a]" />
              İlanSitesi
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
                  "px-3.5 py-2 rounded-full text-sm font-semibold transition",
                  "text-[#3f2a1a] hover:bg-[#f7ede2]",
                  desktopMegaOpen && "bg-[#1f2a24] text-white"
                )}
              >
                Kategoriler ▾
              </button>

              {desktopMegaMenu}
            </div>
          </div>

          {/* CENTER: Desktop search */}
          <div className="hidden md:flex flex-1 max-w-md">
            <div className="w-full relative">
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitSearch()}
                placeholder="Ürün, oyun, figür, kart..."
                className={cx(
                  "w-full rounded-full border border-[#ead8c5] bg-white/70 px-4 py-2.5 pr-10 text-sm text-[#3f2a1a] placeholder:text-[#9b7b5a]",
                  "focus:outline-none focus:ring-2 focus:ring-[#e7c49b] focus:border-[#d9b28a]"
                )}
              />
              <button
                onClick={submitSearch}
                aria-label="Ara"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full hover:bg-[#f7ede2] flex items-center justify-center"
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

          {/* RIGHT */}
          <div className="flex items-center gap-2">
            {/* DESKTOP: actions in order */}
            <div className="hidden md:flex items-center gap-2">
              <Link
                href="/new"
                className="bg-[#1f2a24] hover:bg-[#2b3b32] text-white px-4 py-2 rounded-full text-sm font-semibold transition shadow-sm"
              >
                + İlan Ver
              </Link>

              <Link
                href="/my/messages"
                className="relative px-3 py-2 rounded-full text-sm font-semibold text-[#3f2a1a] hover:bg-[#f7ede2]"
              >
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
                className="px-3 py-2 rounded-full text-sm font-semibold text-[#3f2a1a] hover:bg-[#f7ede2]"
              >
                Hesabım
              </Link>

              {isSignedIn ? (
                <button
                  onClick={handleLogout}
                  className="px-3 py-2 rounded-full text-sm font-semibold text-[#a03a2e] hover:bg-[#fdeeee]"
                >
                  Çıkış Yap
                </button>
              ) : (
                <Link
                  href="/login"
                  className="px-3 py-2 rounded-full text-sm font-semibold text-[#3f2a1a] hover:bg-[#f7ede2]"
                >
                  Giriş Yap
                </Link>
              )}
            </div>

            {/* MOBILE quick actions */}
            <div className="md:hidden flex items-center gap-2">
              <Link
                href="/new"
                className="px-3 py-2 rounded-full bg-[#1f2a24] hover:bg-[#2b3b32] text-white text-xs font-semibold"
              >
                + İlan
              </Link>
            </div>

            {/* MOBILE hamburger */}
            <button
              onClick={() => {
                setCatOpenId(null);
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
        {/* MOBILE inline search */}
        <div className="md:hidden px-4 pb-3">
          <div className="relative">
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitSearch()}
              placeholder="Ürün, oyun, figür, kart..."
              className={cx(
                "w-full rounded-full border border-[#ead8c5] bg-white/70 px-4 py-2.5 pr-10 text-sm text-[#3f2a1a] placeholder:text-[#9b7b5a]",
                "focus:outline-none focus:ring-2 focus:ring-[#e7c49b] focus:border-[#d9b28a]"
              )}
            />
            <button
              onClick={submitSearch}
              aria-label="Ara"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full hover:bg-[#f7ede2] flex items-center justify-center"
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
      </header>

      {/* ✅ Portal drawer */}
      {canUseDOM && mobileDrawer ? createPortal(mobileDrawer, document.body) : null}
    </>
  );
}
