"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Sora } from "next/font/google";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";
import { buildListingPath } from "@/lib/listingUrl";
import { devError, devWarn, getFriendlyErrorMessage } from "@/lib/logger";

/* =======================
   TYPES
======================= */

type Listing = {
  id: string;
  title?: string;
  price?: number;

  categoryId?: string;
  categoryName?: string;

  subCategoryId?: string;
  subCategoryName?: string;

  ownerId?: string;
  imageUrls?: string[];
  createdAt?: any;

  movementType?: string;
  attributes?: Record<string, any>;
  ownerName?: string;
};

type Category = {
  id: string;
  name: string;
  nameLower?: string; // slug
  parentId?: string | null;
  order?: number;
  enabled?: boolean;
  icon?: string;
  imageUrl?: string;
};

type HomeCategoryInput = {
  id?: string;
  name?: string;
  nameLower?: string;
  parentId?: string | null;
  order?: number;
  enabled?: boolean;
  icon?: string;
  imageUrl?: string;
};

type HomeClientProps = {
  initialCategories?: HomeCategoryInput[];
  initialListings?: Listing[];
};

/* =======================
   HELPERS
======================= */

const normalizeText = (v: string) => (v || "").replace(/\s+/g, " ").trim();

const formatPriceTRY = (v?: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${n} TL`;
  }
};

const safeText = (v?: string, fallback = "—") => {
  const t = (v || "").trim();
  return t ? t : fallback;
};

const firstImage = (urls?: string[]) => {
  if (!Array.isArray(urls)) return "";
  return urls[0] || "";
};


const toSlugTR = (s: string) => {
  return s
    .trim()
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
};

const timeAgoTR = (createdAt: any) => {
  try {
    let d: Date | null =
      createdAt?.toDate?.() instanceof Date
        ? createdAt.toDate()
        : createdAt instanceof Date
        ? createdAt
        : null;

    if (!d && typeof createdAt === "string") {
      const parsed = new Date(createdAt);
      if (!Number.isNaN(parsed.getTime())) d = parsed;
    }

    if (!d) return "";

    const diff = Date.now() - d.getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec} sn önce`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} dk önce`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} sa önce`;
    const day = Math.floor(hr / 24);
    return `${day} gün önce`;
  } catch {
    return "";
  }
};

const clampInt = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.trunc(n)));

const normalizeCategories = (items: HomeCategoryInput[]) => {
  return (items || [])
    .map((c) => ({
      id: String(c.id || ""),
      name: String(c.name || ""),
      nameLower: c.nameLower,
      parentId: c.parentId ?? null,
      order: c.order ?? 0,
      enabled: c.enabled,
      icon: c.icon,
      imageUrl: c.imageUrl,
    }))
    .filter((c) => c.id && c.name);
};

const loadFirestore = async () => {
  const [{ db }, firestore] = await Promise.all([
    import("@/lib/firebase"),
    import("firebase/firestore"),
  ]);
  return { db, ...firestore };
};

const loadCatalogCache = async () => {
  return import("@/lib/catalogCache");
};

/* =======================
   URL HELPERS (pickEnum fix)
======================= */

function pickEnum<T extends string>(
  raw: string | null | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  if (!raw) return fallback;
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

function cleanParam(v: string) {
  return normalizeText(v || "");
}

/* =======================
   CONSTS
======================= */

const SORT_OPTIONS = ["newest", "price_asc", "price_desc"] as const;

// Firestore pagination limit (paged listings fetch)
const LISTINGS_PAGE_SIZE = 60;

// UI list growth per "load more"
const UI_STEP = 24;
const UI_MAX = 240;

const sora = Sora({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

/* =======================
   PAGE
======================= */

function HomeInner({ initialCategories = [], initialListings = [] }: HomeClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const normalizedInitialCategories = normalizeCategories(initialCategories);
  const hasInitial =
    normalizedInitialCategories.length > 0 || initialListings.length > 0;
  const [loading, setLoading] = useState(!hasInitial);
  const [fatalError, setFatalError] = useState<string>("");

  // data
  const [categories, setCategories] =
    useState<Category[]>(normalizedInitialCategories);

  // listings pagination
  const [recentListings, setRecentListings] =
    useState<Listing[]>(initialListings);
  const [lastListingDoc, setLastListingDoc] =
    useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMoreListings, setHasMoreListings] = useState(
    initialListings.length ? initialListings.length === LISTINGS_PAGE_SIZE : true
  );
  const [loadingMoreListings, setLoadingMoreListings] = useState(false);

  // UI visible limit
  const [displayLimit, setDisplayLimit] = useState<number>(24);

  const categoryTrackRef = useRef<HTMLDivElement>(null);
  const scrollCategories = (dir: "prev" | "next") => {
    const track = categoryTrackRef.current;
    if (!track) return;
    const firstCard = track.querySelector<HTMLElement>("[data-cat-card]");
    const cardWidth = firstCard?.offsetWidth || 220;
    const gap = 16;
    const delta = (cardWidth + gap) * 4;
    track.scrollBy({
      left: dir === "next" ? delta : -delta,
      behavior: "smooth",
    });
  };

  /* =======================
     FILTER STATE
  ======================= */

  const [searchText, setSearchText] = useState("");

  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [subCategoryFilter, setSubCategoryFilter] = useState<string>("");

  const [priceMin, setPriceMin] = useState<string>("");
  const [priceMax, setPriceMax] = useState<string>("");

  const [sortBy, setSortBy] = useState<(typeof SORT_OPTIONS)[number]>("newest");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const resetFilters = () => {
    setSearchText("");
    setCategoryFilter("");
    setSubCategoryFilter("");
    setPriceMin("");
    setPriceMax("");
    setSortBy("newest");
    setDisplayLimit(24);
  };

  const activeFiltersCount = useMemo(() => {
    let c = 0;
    if (searchText.trim()) c++;
    if (categoryFilter) c++;
    if (subCategoryFilter) c++;
    if (priceMin.trim()) c++;
    if (priceMax.trim()) c++;
    if (sortBy !== "newest") c++;
    return c;
  }, [searchText, categoryFilter, subCategoryFilter, priceMin, priceMax, sortBy]);

  useEffect(() => {
    if (activeFiltersCount > 0) setFiltersOpen(true);
  }, [activeFiltersCount]);

  /* =======================
     URL INIT (read filters from URL)
  ======================= */

  const urlHydratingRef = useRef(false);
  const urlReadyRef = useRef(false);

  useEffect(() => {
    // on route load: URL -> state
    urlHydratingRef.current = true;
    urlReadyRef.current = false;

    const sp = new URLSearchParams(searchParams?.toString() || "");

    const q = cleanParam(sp.get("q") || "");
    setSearchText(q);

    setCategoryFilter(cleanParam(sp.get("cat") || ""));
    setSubCategoryFilter(cleanParam(sp.get("sub") || ""));

    setPriceMin(cleanParam(sp.get("pmin") || "").replace(/[^\d]/g, ""));
    setPriceMax(cleanParam(sp.get("pmax") || "").replace(/[^\d]/g, ""));

    setSortBy(pickEnum(sp.get("sort"), SORT_OPTIONS, "newest"));

    const dlRaw = Number(sp.get("dl") || "");
    const dl = Number.isFinite(dlRaw) ? clampInt(dlRaw, 24, UI_MAX) : 24;
    setDisplayLimit(dl);

    // URL ready
    setTimeout(() => {
      urlHydratingRef.current = false;
      urlReadyRef.current = true;
    }, 0);
  }, [searchParams]);

  /* =======================
     URL SYNC (write filters to URL)
  ======================= */

  useEffect(() => {
    if (!pathname) return;
    if (!urlReadyRef.current) return;
    if (urlHydratingRef.current) return;

    const sp = new URLSearchParams();

    if (searchText.trim()) sp.set("q", searchText.trim());
    if (categoryFilter) sp.set("cat", categoryFilter);
    if (subCategoryFilter) sp.set("sub", subCategoryFilter);

    if (priceMin.trim()) sp.set("pmin", priceMin.trim());
    if (priceMax.trim()) sp.set("pmax", priceMax.trim());

    if (sortBy !== "newest") sp.set("sort", sortBy);

    if (displayLimit !== 24) sp.set("dl", String(displayLimit));

    const nextQs = sp.toString();
    const curQs = searchParams?.toString() || "";

    if (nextQs === curQs) return;

    const nextUrl = nextQs ? `${pathname}?${nextQs}` : pathname;
    router.replace(nextUrl, { scroll: false });
  }, [
    pathname,
    router,
    searchParams,
    searchText,
    categoryFilter,
    subCategoryFilter,
    priceMin,
    priceMax,
    sortBy,
    displayLimit,
  ]);

  /* =======================
     LOAD (categories + first page listings)
  ======================= */

  useEffect(() => {
    let cancelled = false;

    async function loadFirst() {
      setLoading(true);
      setFatalError("");

      try {
        const { db, collection, getDocs, query, orderBy, limit } =
          await loadFirestore();
        const { getCategoriesCached } = await loadCatalogCache();

        const listingsQ = query(
          collection(db, "listings"),
          orderBy("createdAt", "desc"),
          limit(LISTINGS_PAGE_SIZE)
        );

        const [cachedCategories, lSnap] = await Promise.all([
          getCategoriesCached(),
          getDocs(listingsQ),
        ]);

        if (cancelled) return;

        const b = (cachedCategories || []).map((d: any) => ({
          id: d.id,
          ...(d as any),
        })) as Category[];

        const rawL = lSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as Listing[];

        // DEDUPE (duplicate key fix)
        const seen = new Set<string>();
        const l: Listing[] = [];
        for (const item of rawL) {
          if (!item?.id) continue;
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          l.push(item);
        }

        setCategories(Array.isArray(b) ? b : []);
        setRecentListings(l);

        const newLast =
          lSnap.docs.length > 0 ? lSnap.docs[lSnap.docs.length - 1] : null;

        setLastListingDoc(newLast);
        setHasMoreListings(lSnap.docs.length === LISTINGS_PAGE_SIZE);
      } catch (e: any) {
        devError("Home load error:", e);
        if (!cancelled) {
          setFatalError(
            getFriendlyErrorMessage(
              e,
              "Anasayfa verileri yüklenirken hata oluştu."
            )
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (!hasInitial) {
      loadFirst();
    }
    return () => {
      cancelled = true;
    };
  }, [hasInitial]);

  /* =======================
     LOAD MORE LISTINGS (pagination + dedupe)
  ======================= */

  const loadMoreListings = async () => {
    if (loadingMoreListings) return;
    if (!hasMoreListings) return;

    setLoadingMoreListings(true);

    try {
      const { db, collection, getDocs, query, orderBy, limit, startAfter } =
        await loadFirestore();

      let anchor = lastListingDoc;
      if (!anchor) {
        const firstQ = query(
          collection(db, "listings"),
          orderBy("createdAt", "desc"),
          limit(LISTINGS_PAGE_SIZE)
        );
        const firstSnap = await getDocs(firstQ);
        anchor =
          firstSnap.docs.length > 0
            ? firstSnap.docs[firstSnap.docs.length - 1]
            : null;
        setLastListingDoc(anchor);
        setHasMoreListings(firstSnap.docs.length === LISTINGS_PAGE_SIZE);
      }

      if (!anchor) return;
      const qMore = query(
        collection(db, "listings"),
        orderBy("createdAt", "desc"),
        startAfter(anchor),
        limit(LISTINGS_PAGE_SIZE)
      );

      const snap = await getDocs(qMore);

      const raw = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      })) as Listing[];

      const newLast =
        snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;

      setLastListingDoc(newLast);
      setHasMoreListings(snap.docs.length === LISTINGS_PAGE_SIZE);

      // append + dedupe
      setRecentListings((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        const merged = [...prev];
        for (const it of raw) {
          if (!it?.id) continue;
          if (seen.has(it.id)) continue;
          seen.add(it.id);
          merged.push(it);
        }
        return merged;
      });
    } catch (e) {
      devError("loadMoreListings error:", e);
    } finally {
      setLoadingMoreListings(false);
    }
  };

  /* =======================
     DERIVED: Categories
  ======================= */

  const categoryById = useMemo(() => {
    const map = new Map<string, Category>();
    for (const b of categories) map.set(b.id, b);
    return map;
  }, [categories]);

  const mainCategories = useMemo(() => {
    return categories
      .filter((c) => !c.parentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [categories]);

  const activeMainCategories = useMemo(() => {
    return mainCategories.filter((c) => c.enabled !== false);
  }, [mainCategories]);

  const allSubCategories = useMemo(() => {
    return categories
      .filter((c) => !!c.parentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [categories]);

  const filteredSubCategories = useMemo(() => {
    const base = allSubCategories.filter((c) => c.enabled !== false);
    if (!categoryFilter) return base;
    return base.filter((c) => c.parentId === categoryFilter);
  }, [allSubCategories, categoryFilter]);

  useEffect(() => {
    if (!subCategoryFilter) return;
    const valid = allSubCategories.some(
      (c) =>
        c.id === subCategoryFilter &&
        (categoryFilter ? c.parentId === categoryFilter : true)
    );
    if (!valid) setSubCategoryFilter("");
  }, [allSubCategories, categoryFilter, subCategoryFilter]);

  /* =======================
     FILTERING (client-side)
  ======================= */

  const filteredListings = useMemo(() => {
    const q = searchText.trim().toLowerCase();

    const min = priceMin.trim() ? Number(priceMin.trim()) : null;
    const max = priceMax.trim() ? Number(priceMax.trim()) : null;

    const selectedCategory = categoryFilter
      ? categoryById.get(categoryFilter)
      : null;
    const selectedCategorySlug = selectedCategory
      ? selectedCategory.nameLower || toSlugTR(selectedCategory.name)
      : "";

    const selectedSubCategory = subCategoryFilter
      ? categoryById.get(subCategoryFilter)
      : null;
    const selectedSubCategorySlug = selectedSubCategory
      ? selectedSubCategory.nameLower || toSlugTR(selectedSubCategory.name)
      : "";

    let arr = recentListings.slice();

    arr = arr.filter((l) => {
      // search
      if (q) {
        const hay = [l.title || "", l.categoryName || "", l.subCategoryName || ""]
          .join(" ")
          .toLowerCase();

        if (!hay.includes(q)) return false;
      }

      if (categoryFilter) {
        const matchId = (l.categoryId || "") === categoryFilter;
        const matchName =
          !!selectedCategorySlug &&
          toSlugTR(l.categoryName || "") === selectedCategorySlug;
        if (!matchId && !matchName) return false;
      }

      if (subCategoryFilter) {
        const matchId = (l.subCategoryId || "") === subCategoryFilter;
        const matchName =
          !!selectedSubCategorySlug &&
          toSlugTR(l.subCategoryName || "") === selectedSubCategorySlug;
        if (!matchId && !matchName) return false;
      }

      // price range
      const p = Number(l.price);
      if (min !== null && Number.isFinite(min)) {
        if (!Number.isFinite(p) || p < min) return false;
      }
      if (max !== null && Number.isFinite(max)) {
        if (!Number.isFinite(p) || p > max) return false;
      }

      return true;
    });

    // sort
    if (sortBy === "price_asc") {
      arr.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
    } else if (sortBy === "price_desc") {
      arr.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
    } else {
      arr.sort((a, b) => {
        const da = a.createdAt?.toDate?.() ? a.createdAt.toDate().getTime() : 0;
        const dbb = b.createdAt?.toDate?.() ? b.createdAt.toDate().getTime() : 0;
        return dbb - da;
      });
    }

    return arr;
  }, [
    recentListings,
    searchText,
    categoryFilter,
    subCategoryFilter,
    priceMin,
    priceMax,
    sortBy,
    categoryById,
  ]);

  const gridListings = useMemo(() => {
    return filteredListings.slice(0, displayLimit);
  }, [filteredListings, displayLimit]);

  // Owner names are expected to be included in initial listing payload.

  const totalFound = filteredListings.length;

  /* =======================
     SHOW MORE (UI + fetch more if needed)
  ======================= */

  const handleShowMore = async () => {
    const nextLimit = clampInt(displayLimit + UI_STEP, 24, UI_MAX);

    // If user wants more but not enough listings:
    // fetch next page from Firestore
    if (nextLimit > recentListings.length && hasMoreListings) {
      await loadMoreListings();
    }

    setDisplayLimit(nextLimit);
  };

  /* =======================
     UI STATES
  ======================= */

  if (loading) {
    return (
      <div className={`min-h-screen bg-[#f7f4ef] px-4 py-10 ${sora.className}`}>
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="bg-white/90 rounded-2xl shadow p-8">
            <div className="h-8 w-64 bg-gray-200 rounded mb-3" />
            <div className="h-4 w-96 bg-gray-200 rounded mb-6" />
            <div className="h-12 w-full bg-gray-200 rounded" />
          </div>

          <div className="bg-white/90 rounded-2xl shadow p-8">
            <div className="h-6 w-56 bg-gray-200 rounded mb-4" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-64 bg-gray-200 rounded-2xl" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (fatalError) {
    return (
      <div className={`min-h-screen bg-[#f7f4ef] px-4 py-10 ${sora.className}`}>
        <div className="max-w-3xl mx-auto bg-white/90 rounded-2xl shadow p-8 text-center">
          <div className="text-red-700 font-semibold mb-2">Hata</div>
          <div className="text-slate-700 mb-6">{fatalError}</div>
          <button
            onClick={() => router.push("/")}
            className="underline text-blue-600"
          >
            Yeniden dene
          </button>
        </div>
      </div>
    );
  }

  /* =======================
     UI
  ======================= */

  return (
    <div
      className="min-h-screen bg-[#f7f4ef] text-[color:var(--market-ink)] relative overflow-hidden"
      style={{
        ["--market-ink" as any]: "#0f172a",
        ["--market-muted" as any]: "#64748b",
        ["--market-accent" as any]: "#0f766e",
        ["--market-accent-strong" as any]: "#0b5e57",
      }}
    >
      <style jsx global>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
      `}</style>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="absolute top-32 -left-28 h-80 w-80 rounded-full bg-amber-200/40 blur-3xl" />
      </div>
      <main
        className={`${sora.className} relative z-10 max-w-6xl mx-auto px-4 py-6 space-y-6`}
      >
        {/* ======================================================
           ✅ KATEGORİLER
        ====================================================== */}
        <section className="bg-white/90 backdrop-blur border border-white/70 rounded-2xl shadow-[0_10px_30px_rgba(15,23,42,0.08)] p-5 sm:p-6">
          {activeMainCategories.length === 0 ? (
            <div className="mt-4 text-sm text-[color:var(--market-muted)]">
              Henüz aktif kategori yok.
            </div>
          ) : (
            <div className="relative mt-2 overflow-hidden px-10 sm:px-12">
              <button
                type="button"
                onClick={() => scrollCategories("prev")}
                className="absolute left-1 sm:left-2 top-1/2 -translate-y-1/2 z-10 h-8 w-8 sm:h-9 sm:w-9 rounded-full border border-slate-200/80 bg-white/90 text-slate-600 hover:bg-white shadow-sm"
                aria-label="Önceki kategoriler"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => scrollCategories("next")}
                className="absolute right-1 sm:right-2 top-1/2 -translate-y-1/2 z-10 h-8 w-8 sm:h-9 sm:w-9 rounded-full border border-slate-200/80 bg-white/90 text-slate-600 hover:bg-white shadow-sm"
                aria-label="Sonraki kategoriler"
              >
                →
              </button>

              <div
                ref={categoryTrackRef}
                className="no-scrollbar flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-3 px-0"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                {activeMainCategories.map((cat) => {
                  const slug = cat.nameLower || toSlugTR(cat.name);
                  const fallbackIcon = cat.icon || "📁";

                  return (
                    <Link
                      key={cat.id}
                      href={`/${slug}`}
                      data-cat-card
                      className="group relative h-32 shrink-0 snap-start rounded-2xl overflow-hidden border border-white/60 bg-slate-900 w-[calc((100%-16px)/2)] sm:w-[calc((100%-48px)/4)]"
                    >
                      {cat.imageUrl ? (
                        <Image
                          src={cat.imageUrl}
                          alt={cat.name}
                          fill
                          sizes="(min-width: 640px) 25vw, 50vw"
                          className="object-cover"
                        />
                      ) : (
                        <div className="h-full w-full bg-gradient-to-br from-slate-800 via-slate-700 to-slate-900 flex items-center justify-center text-3xl">
                          {fallbackIcon}
                        </div>
                      )}

                      <div className="absolute inset-0 bg-emerald-500/0 group-hover:bg-emerald-500/30 transition" />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-900/70 via-transparent to-transparent" />
                      <div className="absolute bottom-3 left-3 right-3 text-white text-sm font-semibold drop-shadow">
                        {cat.name}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-4 border border-slate-200/70 rounded-2xl bg-white/80 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-800">Filtreler</div>
              <button
                type="button"
                onClick={() => setFiltersOpen((v) => !v)}
                className="md:hidden inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-white"
              >
                {activeFiltersCount > 0 ? (
                  <span className="inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-emerald-600 text-white text-[10px]">
                    {activeFiltersCount}
                  </span>
                ) : null}
                <span className="text-sm leading-none">
                  {filtersOpen ? "−" : "+"}
                </span>
              </button>
            </div>

            <div className="mt-3 hidden md:flex md:flex-wrap md:items-center gap-2">
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Ara..."
                aria-label="Arama"
                className="h-9 sm:h-10 w-full sm:w-[160px] rounded-full border border-slate-200/80 bg-white/90 px-3 sm:px-4 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--market-accent)]/20 focus:border-[color:var(--market-accent)]"
              />

              <select
                value={categoryFilter}
                onChange={(e) => {
                  const next = e.target.value;
                  setCategoryFilter(next);
                  if (subCategoryFilter) setSubCategoryFilter("");
                }}
                aria-label="Kategori"
                className="h-9 sm:h-10 w-full sm:w-[140px] rounded-full border border-slate-200/80 bg-white/90 px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--market-accent)]/20 focus:border-[color:var(--market-accent)]"
              >
                <option value="">Kategori</option>
                {activeMainCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>

              <select
                value={subCategoryFilter}
                onChange={(e) => setSubCategoryFilter(e.target.value)}
                aria-label="Alt kategori"
                disabled={filteredSubCategories.length === 0}
                className="h-9 sm:h-10 w-full sm:w-[170px] rounded-full border border-slate-200/80 bg-white/90 px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--market-accent)]/20 focus:border-[color:var(--market-accent)] disabled:opacity-60"
              >
                <option value="">Alt kategori</option>
                {filteredSubCategories.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name}
                  </option>
                ))}
              </select>

              <input
                type="number"
                value={priceMin}
                onChange={(e) => setPriceMin(e.target.value)}
                className="h-9 sm:h-10 w-full sm:w-[90px] rounded-full border border-slate-200/80 bg-white/90 px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--market-accent)]/20 focus:border-[color:var(--market-accent)]"
                placeholder="Min TL"
                aria-label="Minimum fiyat"
                min={0}
              />

              <input
                type="number"
                value={priceMax}
                onChange={(e) => setPriceMax(e.target.value)}
                className="h-9 sm:h-10 w-full sm:w-[90px] rounded-full border border-slate-200/80 bg-white/90 px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--market-accent)]/20 focus:border-[color:var(--market-accent)]"
                placeholder="Max TL"
                aria-label="Maksimum fiyat"
                min={0}
              />

              <select
                value={sortBy}
                onChange={(e) =>
                  setSortBy(pickEnum(e.target.value, SORT_OPTIONS, "newest"))
                }
                aria-label="Sıralama"
                className="h-9 sm:h-10 w-full sm:w-[150px] rounded-full border border-slate-200/80 bg-white/90 px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--market-accent)]/20 focus:border-[color:var(--market-accent)]"
              >
                <option value="newest">En yeni</option>
                <option value="price_asc">Fiyat (artan)</option>
                <option value="price_desc">Fiyat (azalan)</option>
              </select>

              <button
                type="button"
                onClick={resetFilters}
                className="h-9 sm:h-10 rounded-full border border-slate-200/80 px-3 sm:px-4 text-sm text-slate-700 bg-white/70 hover:bg-white shadow-sm"
              >
                Sıfırla
              </button>
            </div>

            {filtersOpen && (
              <div className="mt-3 grid grid-cols-2 gap-2 md:hidden">
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Ara..."
                  aria-label="Arama"
                  className="col-span-2 h-9 sm:h-10 w-full sm:w-[160px] rounded-full border border-slate-200/80 bg-white/90 px-3 sm:px-4 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--market-accent)]/20 focus:border-[color:var(--market-accent)]"
                />

                <select
                  value={categoryFilter}
                  onChange={(e) => {
                    const next = e.target.value;
                    setCategoryFilter(next);
                    if (subCategoryFilter) setSubCategoryFilter("");
                  }}
                  aria-label="Kategori"
                  className="h-9 sm:h-10 w-full sm:w-[140px] rounded-full border border-slate-200/80 bg-white/90 px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--market-accent)]/20 focus:border-[color:var(--market-accent)]"
                >
                  <option value="">Kategori</option>
                  {activeMainCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>

                <select
                  value={subCategoryFilter}
                  onChange={(e) => setSubCategoryFilter(e.target.value)}
                  aria-label="Alt kategori"
                  disabled={filteredSubCategories.length === 0}
                  className="h-9 sm:h-10 w-full sm:w-[170px] rounded-full border border-slate-200/80 bg-white/90 px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--market-accent)]/20 focus:border-[color:var(--market-accent)] disabled:opacity-60"
                >
                  <option value="">Alt kategori</option>
                  {filteredSubCategories.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  value={priceMin}
                  onChange={(e) => setPriceMin(e.target.value)}
                  className="h-9 sm:h-10 w-full sm:w-[90px] rounded-full border border-slate-200/80 bg-white/90 px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--market-accent)]/20 focus:border-[color:var(--market-accent)]"
                  placeholder="Min TL"
                  aria-label="Minimum fiyat"
                  min={0}
                />

                <input
                  type="number"
                  value={priceMax}
                  onChange={(e) => setPriceMax(e.target.value)}
                  className="h-9 sm:h-10 w-full sm:w-[90px] rounded-full border border-slate-200/80 bg-white/90 px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--market-accent)]/20 focus:border-[color:var(--market-accent)]"
                  placeholder="Max TL"
                  aria-label="Maksimum fiyat"
                  min={0}
                />

                <select
                  value={sortBy}
                  onChange={(e) =>
                    setSortBy(pickEnum(e.target.value, SORT_OPTIONS, "newest"))
                  }
                  aria-label="Sıralama"
                  className="col-span-2 h-9 sm:h-10 w-full sm:w-[150px] rounded-full border border-slate-200/80 bg-white/90 px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--market-accent)]/20 focus:border-[color:var(--market-accent)]"
                >
                  <option value="newest">En yeni</option>
                  <option value="price_asc">Fiyat (artan)</option>
                  <option value="price_desc">Fiyat (azalan)</option>
                </select>

                <button
                  type="button"
                  onClick={resetFilters}
                  className="col-span-2 h-9 sm:h-10 rounded-full border border-slate-200/80 px-3 sm:px-4 text-sm text-slate-700 bg-white/70 hover:bg-white shadow-sm"
                >
                  Sıfırla
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ======================================================
           ✅ SON İLANLAR
        ====================================================== */}
        <section
          id="latest-listings"
          className="bg-white/90 backdrop-blur border border-white/70 rounded-2xl shadow-[0_10px_30px_rgba(15,23,42,0.08)] p-5 sm:p-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg sm:text-xl font-semibold tracking-tight">
                Son ilanlar
              </h2>
              <div className="text-xs text-[color:var(--market-muted)] mt-1">
                {totalFound} sonuç
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-full border border-slate-200/70 bg-white/80 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                    viewMode === "grid"
                      ? "bg-[color:var(--market-accent)] text-white"
                      : "text-slate-600 hover:bg-white"
                  }`}
                >
                  Grid
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                    viewMode === "list"
                      ? "bg-[color:var(--market-accent)] text-white"
                      : "text-slate-600 hover:bg-white"
                  }`}
                >
                  Liste
                </button>
              </div>

              <Link
                href="/new"
                className="bg-[color:var(--market-accent)] hover:bg-[color:var(--market-accent-strong)] text-white font-semibold px-4 py-2 rounded-full text-sm shadow-sm"
              >
                İlan Ver
              </Link>
            </div>
          </div>

          {gridListings.length === 0 ? (
            <div className="mt-8 border border-slate-200/70 rounded-2xl p-6 text-center bg-white/80">
              <div className="font-semibold text-slate-900">
                Bu filtrelerle ilan bulunamadı.
              </div>
              <div className="text-sm text-[color:var(--market-muted)] mt-1">
                Filtreleri gevşetebilir veya sıfırlayabilirsin.
              </div>

              <button
                type="button"
                onClick={() => resetFilters()}
                className="mt-4 bg-[color:var(--market-accent)] hover:bg-[color:var(--market-accent-strong)] text-white font-semibold px-5 py-3 rounded-full"
              >
                Filtreleri sıfırla
              </button>
            </div>
          ) : (
            <>
              {viewMode === "grid" ? (
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {gridListings.map((l) => {
                    const thumb = firstImage(l.imageUrls);
                    const category = safeText(l.categoryName, "");
                    const subCategory = safeText(l.subCategoryName, "");
                    const ago = timeAgoTR(l.createdAt);

                    return (
                      <Link
                        key={l.id}
                        href={buildListingPath(l.id, l.title)}
                        prefetch={false}
                        className="block"
                      >
                        <div className="border border-slate-200/70 rounded-2xl overflow-hidden bg-white/90 hover:shadow-[0_12px_30px_rgba(15,23,42,0.12)] transition hover:-translate-y-0.5">
                          {thumb ? (
                            <div className="relative w-full h-44">
                              <Image
                                src={thumb}
                                alt={safeText(l.title, "İlan")}
                                fill
                                sizes="(max-width: 640px) 75vw, (max-width: 1024px) 40vw, 300px"
                                quality={45}
                                className="object-cover"
                              />
                            </div>
                          ) : (
                            <div className="w-full h-44 bg-slate-100 flex items-center justify-center text-slate-400 text-sm">
                              Görsel yok
                            </div>
                          )}

                          <div className="p-4 space-y-2">
                            <div className="font-semibold line-clamp-2 text-[15px]">
                              {safeText(l.title, "İlan")}
                            </div>

                            <div className="flex items-center justify-between gap-2 text-sm">
                              <div className="text-slate-600 line-clamp-1">
                                {officialName}
                              </div>
                              <div className="text-[color:var(--market-accent)] font-semibold text-[18px] shrink-0">
                                {formatPriceTRY(l.price)}
                              </div>
                            </div>

                            <div className="pt-1 text-xs text-slate-400 space-y-1">
                              <div className="text-slate-500">
                                {sellerName || "Satıcı"}
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <div className="truncate">
                                  {category}
                                  {subCategory ? ` / ${subCategory}` : ""}
                                </div>
                                <div className="shrink-0 text-right">{ago}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-6 space-y-3">
                  {gridListings.map((l) => {
                    const thumb = firstImage(l.imageUrls);
                    const category = safeText(l.categoryName, "");
                    const subCategory = safeText(l.subCategoryName, "");
                    const ago = timeAgoTR(l.createdAt);
                    const attrs = (l as any)?.attributes || {};
                    const sellerName =
                      l.ownerName ||
                      (l as any)?.ownerDisplayName ||
                      (l as any)?.sellerName ||
                      "";
                    const officialNameRaw =
                      attrs.gameName ||
                      attrs.consoleModel ||
                      attrs.modelName ||
                      attrs.model ||
                      "";
                    const officialName =
                      officialNameRaw || safeText(l.subCategoryName, "—");

                    return (
                      <Link
                        key={l.id}
                        href={buildListingPath(l.id, l.title)}
                        prefetch={false}
                        className="block"
                      >
                        <div className="border border-slate-200/70 rounded-2xl bg-white/90 hover:shadow-[0_12px_30px_rgba(15,23,42,0.12)] transition hover:-translate-y-0.5 p-2.5 sm:p-3 flex gap-3 items-center">
                          <div className="relative w-20 h-16 sm:w-24 sm:h-20 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0">
                            {thumb ? (
                              <Image
                                src={thumb}
                                alt={safeText(l.title, "İlan")}
                                fill
                                sizes="120px"
                                quality={45}
                                className="object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
                                Görsel yok
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="font-semibold line-clamp-2 text-sm sm:text-base">
                                {safeText(l.title, "İlan")}
                              </div>
                              <div className="text-[color:var(--market-accent)] font-semibold text-base sm:text-lg shrink-0">
                                {formatPriceTRY(l.price)}
                              </div>
                            </div>

                            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] sm:text-xs text-slate-500">
                              <div className="truncate">
                                {category}
                                {subCategory ? ` / ${subCategory}` : ""}
                              </div>
                              <div className="shrink-0">{ago}</div>
                            </div>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}

              <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="text-sm text-[color:var(--market-muted)]">
                  Gösterilen:{" "}
                  <span className="font-semibold">{gridListings.length}</span> /{" "}
                  <span className="font-semibold">{totalFound}</span> sonuç
                  {hasMoreListings ? (
                    <span className="ml-2 text-xs text-slate-400">
                      (arkada daha çok ilan var)
                    </span>
                  ) : null}
                </div>

                <div className="flex gap-3">
                  {gridListings.length < totalFound && (
                    <button
                      type="button"
                      onClick={handleShowMore}
                      disabled={loadingMoreListings}
                      className={`px-5 py-3 rounded-full font-semibold text-white ${
                        loadingMoreListings
                          ? "bg-slate-300 cursor-not-allowed"
                          : "bg-[color:var(--market-accent)] hover:bg-[color:var(--market-accent-strong)]"
                      }`}
                    >
                      {loadingMoreListings ? "Yükleniyor..." : "Daha fazla göster"}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                    className="text-sm underline text-[color:var(--market-muted)]"
                  >
                    Yukarı çık
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        {/* =======================
            FOOTER CTA
        ======================= */}
        <section className="bg-[linear-gradient(120deg,#0f766e,#22c55e)] rounded-2xl shadow-[0_16px_40px_rgba(15,23,42,0.18)] p-8 text-white">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="text-2xl font-semibold">
                İlanını dakikalar içinde yayınla
              </div>
              <div className="text-sm text-emerald-50 mt-1">
                Hobi, oyun, koleksiyon ve konsol ürünlerinde alıcılar seni kolayca bulsun.
              </div>
            </div>

            <div className="flex gap-3">
              <Link
                href="/new"
                className="bg-white text-emerald-700 font-semibold px-6 py-3 rounded-full"
              >
                İlan Ver
              </Link>
              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById("latest-listings");
                  if (el)
                    el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="border border-white/70 hover:bg-white/10 font-semibold px-6 py-3 rounded-full"
              >
                İlanları Gör
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function HomeClient(props: HomeClientProps) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-gray-600">
          Yükleniyor...
        </div>
      }
    >
      <HomeInner {...props} />
    </Suspense>
  );
}
