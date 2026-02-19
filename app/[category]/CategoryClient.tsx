"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useParams,
  useRouter,
  useSearchParams,
  usePathname,
} from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Sora } from "next/font/google";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getCountFromServer,
  DocumentData,
  QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getCategoriesCached, getSubCategoriesCached } from "@/lib/catalogCache";
import { devError, getFriendlyErrorMessage } from "@/lib/logger";
import { buildListingPath, slugifyTR } from "@/lib/listingUrl";

/* ================= TYPES ================= */

type Category = {
  id: string;
  name: string;
  nameLower: string;
};

type SubCategory = {
  id: string;
  name: string;
  nameLower: string;
  categoryId?: string;
};

type Listing = {
  id: string;
  title?: string;
  price?: number;

  categoryId?: string;
  categoryName?: string;

  subCategoryId?: string;
  subCategoryName?: string;

  productionYear?: string | null;
  gender?: string;
  movementType?: string;

  caseType?: string;
  diameterMm?: number | null;

  braceletMaterial?: string;

  wearExists?: boolean;

  imageUrls?: string[];
  createdAt?: any;
  ownerId?: string;
};

type CategoryClientProps = {
  initialCategory?: Category | null;
  initialSubCategories?: SubCategory[];
  initialListings?: Listing[];
  initialTotalCount?: number | null;
  initialHasMore?: boolean;
};

/* ================= HELPERS ================= */

const normalizeSpaces = (v: string) => (v || "").replace(/\s+/g, " ").trim();

const safeText = (v?: string, fallback = "—") => {
  const t = normalizeSpaces(v || "");
  return t ? t : fallback;
};

const normTR = (v?: string) =>
  normalizeSpaces(v || "").toLocaleLowerCase("tr-TR");

const normTRAscii = (v?: string) =>
  normTR(v)
    .replaceAll("ı", "i")
    .replaceAll("ş", "s")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replaceAll("İ", "i")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

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

const firstImage = (urls?: string[]) => {
  if (!Array.isArray(urls)) return "";
  return urls[0] || "";
};

const timeAgoTR = (createdAt: any) => {
  try {
    const d: Date =
      createdAt?.toDate?.() instanceof Date
        ? createdAt.toDate()
        : createdAt instanceof Date
        ? createdAt
        : null;

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

const toIntOrNull = (v: string) => {
  const t = (v || "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

const toNumOrNull = (v: string) => {
  const t = (v || "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const getYearNumber = (v?: string | null) => {
  const s = (v || "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

const getDiaNumber = (v?: number | null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const compactLabel = (s?: string) => {
  const t = normalizeSpaces(s || "");
  return t.length > 18 ? t.slice(0, 18) + "…" : t;
};

const clampInt = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.trunc(n)));

const pickEnum = (v: string | null, allowed: string[]) => {
  if (!v) return "";
  return allowed.includes(v) ? v : "";
};

const cleanDigits = (v: string) => (v || "").replace(/[^\d]/g, "");

const sora = Sora({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

/* ================= PAGE ================= */

export default function CategoryClient({
  initialCategory = null,
  initialSubCategories = [],
  initialListings = [],
  initialTotalCount = null,
  initialHasMore = false,
}: CategoryClientProps) {
  const params = useParams<{ category: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const categorySlug = params?.category
    ? decodeURIComponent(params.category)
    : "";

  /* ================= DATA ================= */

  const [category, setCategory] = useState<Category | null>(initialCategory);
  const [subCategories, setSubCategories] = useState<SubCategory[]>(
    initialSubCategories
  );

  // ✅ Pagination ile yüklenen ham ilanlar
  const [listingsRaw, setListingsRaw] = useState<Listing[]>(initialListings);
  const [cursor, setCursor] =
    useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(initialHasMore);

  const [loading, setLoading] = useState(!initialCategory);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // optional: total count
  const [totalCount, setTotalCount] = useState<number | null>(
    initialTotalCount
  );

  /* ================= UI STATES ================= */

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [sortMode, setSortMode] = useState<"newest" | "priceAsc" | "priceDesc">(
    "newest"
  );

  // ✅ artık 24/48/96 yerine dinamik (pagination ile uyumlu)
  const [pageSize, setPageSize] = useState<number>(24);

  // search (debounced)
  const [searchText, setSearchText] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      setSearchDebounced(searchText);
    }, 250);
    return () => clearTimeout(t);
  }, [searchText]);

  /* ================= FILTER STATES ================= */

  const [subCategoryId, setSubCategoryId] = useState("");

  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  const [yearMin, setYearMin] = useState("");
  const [yearMax, setYearMax] = useState("");

  const [gender, setGender] = useState("");

  const [wearFilter, setWearFilter] = useState<"" | "wear" | "noWear">("");

  /* ================= OPTIONS ================= */

  const yearOptions = useMemo(() => {
    const now = new Date().getFullYear();
    const years: string[] = [];
    for (let y = now; y >= 1950; y--) years.push(String(y));
    return years;
  }, []);

  const genderOptions = useMemo(
    () => ["Erkek", "Kadın", "Unisex", "Diğer"],
    []
  );

  /* ================= URL SYNC (INIT) ================= */

  const didInitFromUrl = useRef(false);
  const lastReplacedUrl = useRef<string>("");
  const subScrollRef = useRef<HTMLDivElement | null>(null);

  // Category slug değişince URL init’i tekrar izin ver
  useEffect(() => {
    didInitFromUrl.current = false;
  }, [categorySlug]);

  useEffect(() => {
    if (!categorySlug) return;
    if (didInitFromUrl.current) return;

    // ✅ URL’den filtreleri state’e bas
    const q = searchParams.get("q") || "";
    const subCategory = searchParams.get("subCategoryId") || "";
    const minP = searchParams.get("minPrice") || "";
    const maxP = searchParams.get("maxPrice") || "";
    const yMin = searchParams.get("yearMin") || "";
    const yMax = searchParams.get("yearMax") || "";
    const g = searchParams.get("gender") || "";
    const wear = (searchParams.get("wear") || "") as "" | "wear" | "noWear";

    const sort = (searchParams.get("sort") || "newest") as
      | "newest"
      | "priceAsc"
      | "priceDesc";

    const view = (searchParams.get("view") || "grid") as "grid" | "list";

    setSearchText(q);
    setSubCategoryId(subCategory);

    setMinPrice(cleanDigits(minP));
    setMaxPrice(cleanDigits(maxP));

    setYearMin(cleanDigits(yMin));
    setYearMax(cleanDigits(yMax));

    setGender(pickEnum(g, genderOptions));

    setWearFilter(wear === "wear" || wear === "noWear" ? wear : "");

    setSortMode(sort);
    setViewMode(view);

    // UX: linkten gelince "her şey gelsin" diye 24 bırakıyoruz (istersen 48 yap)
    setPageSize(24);

    didInitFromUrl.current = true;
  }, [
    categorySlug,
    searchParams,
    genderOptions,
  ]);

  /* ================= URL SYNC (STATE → URL) ================= */

  useEffect(() => {
    if (!didInitFromUrl.current) return;
    if (!pathname) return;

    const sp = new URLSearchParams();

    if (searchText.trim()) sp.set("q", searchText.trim());
    if (subCategoryId) sp.set("subCategoryId", subCategoryId);

    if (minPrice.trim()) sp.set("minPrice", minPrice.trim());
    if (maxPrice.trim()) sp.set("maxPrice", maxPrice.trim());

    if (yearMin.trim()) sp.set("yearMin", yearMin.trim());
    if (yearMax.trim()) sp.set("yearMax", yearMax.trim());

    if (gender.trim()) sp.set("gender", gender.trim());

    if (wearFilter) sp.set("wear", wearFilter);

    // UX: sadece default dışını yaz
    if (sortMode !== "newest") sp.set("sort", sortMode);
    if (viewMode !== "grid") sp.set("view", viewMode);

    const qs = sp.toString();
    const nextUrl = qs ? `${pathname}?${qs}` : pathname;

    if (lastReplacedUrl.current === nextUrl) return;

    lastReplacedUrl.current = nextUrl;

    // ✅ filtre değiştikçe URL güncellenir (paylaşılabilir)
    // scroll false ile sayfa yukarı zıplamasın
    try {
      // Next router options bazı projelerde TS’de sıkıntı çıkarabiliyor
      (router.replace as any)(nextUrl, { scroll: false });
    } catch {
      router.replace(nextUrl);
    }
  }, [
    router,
    pathname,
    searchText,
    subCategoryId,
    minPrice,
    maxPrice,
    yearMin,
    yearMax,
    gender,
    wearFilter,
    sortMode,
    viewMode,
  ]);

  /* ================= FILTER UTIL ================= */

  const clearFilters = () => {
    setSubCategoryId("");
    setMinPrice("");
    setMaxPrice("");
    setYearMin("");
    setYearMax("");
    setGender("");
    setWearFilter("");
    setSearchText("");
    setSortMode("newest");
    setViewMode("grid");
    setPageSize(24);
  };

  const appliedFiltersCount = useMemo(() => {
    let c = 0;
    if (subCategoryId.trim()) c++;
    if (minPrice.trim()) c++;
    if (maxPrice.trim()) c++;
    if (yearMin.trim()) c++;
    if (yearMax.trim()) c++;
    if (gender.trim()) c++;
    if (wearFilter) c++;
    if (searchText.trim()) c++;
    if (sortMode !== "newest") c++;
    if (viewMode !== "grid") c++;
    return c;
  }, [
    subCategoryId,
    minPrice,
    maxPrice,
    yearMin,
    yearMax,
    gender,
    wearFilter,
    searchText,
    sortMode,
    viewMode,
  ]);

  useEffect(() => {
    if (appliedFiltersCount > 0) setFiltersOpen(true);
  }, [appliedFiltersCount]);

  /* ================= LOAD BRAND + MODELS + LISTINGS (PAGINATION) ================= */

  const LISTINGS_BATCH = 60;

  const fetchFirstPage = async (categoryId: string) => {
    const q = query(
      collection(db, "listings"),
      where("categoryId", "==", categoryId),
      orderBy("createdAt", "desc"),
      limit(LISTINGS_BATCH)
    );

    const snap = await getDocs(q);
    const docs = snap.docs;

    const page = docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Listing[];

    setCursor(docs.length > 0 ? docs[docs.length - 1] : null);
    setHasMore(docs.length === LISTINGS_BATCH);

    setListingsRaw(page);
  };

  const fetchMore = async (categoryId: string) => {
    if (!hasMore) return;
    if (loadingMore) return;

    if (!cursor) {
      // cursor yoksa zaten ilk sayfadayız veya veri yok
      return;
    }

    setLoadingMore(true);

    try {
      const q = query(
        collection(db, "listings"),
        where("categoryId", "==", categoryId),
        orderBy("createdAt", "desc"),
        startAfter(cursor),
        limit(LISTINGS_BATCH)
      );

      const snap = await getDocs(q);
      const docs = snap.docs;

      const page = docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Listing[];

      setCursor(docs.length > 0 ? docs[docs.length - 1] : cursor);
      setHasMore(docs.length === LISTINGS_BATCH);

      // merge unique
      setListingsRaw((prev) => {
        const map = new Map<string, Listing>();
        for (const x of prev) map.set(x.id, x);
        for (const x of page) map.set(x.id, x);
        return Array.from(map.values());
      });
    } catch (e) {
      devError("fetchMore error:", e);
      // hasMore false yapmıyoruz; kullanıcı tekrar deneyebilir
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!categorySlug) return;

    let cancelled = false;

    async function loadAll() {
      if (!initialCategory) setLoading(true);
      setError(null);

      try {
        // reset pagination state
        setListingsRaw([]);
        setCursor(null);
        setHasMore(true);
        setTotalCount(null);

        // 1) CATEGORY
        const categoryDocs = (await getCategoriesCached()).map((d: any) => ({
          id: d.id,
          ...(d as any),
        }));
        const key = normTRAscii(categorySlug);
        const matchCategory = categoryDocs.find((c) => {
          const keys = [c.id, c.slug, c.nameLower, c.name].map((x) =>
            normTRAscii(x)
          );
          return keys.includes(key);
        });

        if (!matchCategory) throw new Error("Kategori bulunamadı.");

        const canonicalCategorySlug = normTRAscii(matchCategory.name);
        if (canonicalCategorySlug && key !== canonicalCategorySlug) {
          const qs = searchParams?.toString();
          const canonicalPath = `/${encodeURIComponent(canonicalCategorySlug)}`;
          router.replace(qs ? `${canonicalPath}?${qs}` : canonicalPath);
        }

        const b: Category = {
          id: matchCategory.id,
          name: matchCategory.name,
          nameLower: matchCategory.nameLower,
        };

        if (cancelled) return;
        setCategory(b);

        // 2) SUBCATEGORIES
        let subDocs = (await getSubCategoriesCached()).filter(
          (s: any) => s.categoryId === b.id
        );
        if (!subDocs.length) {
          // fallback: subCategories still stored under categories with parentId
          subDocs = categoryDocs.filter((s: any) => s.parentId === b.id);
        }

        if (cancelled) return;

        const ms = subDocs
          .map((d: any) => ({
            id: d.id,
            name: d.name,
            nameLower: d.nameLower,
            categoryId: d.categoryId,
          }))
          .sort((a: any, b: any) =>
            (a.nameLower || a.name).localeCompare(b.nameLower || b.name, "tr")
          ) as SubCategory[];

        setSubCategories(Array.isArray(ms) ? ms : []);

        // 3) LISTINGS FIRST PAGE (pagination)
        await fetchFirstPage(b.id);

        // 4) OPTIONAL COUNT (sessiz fail)
        try {
          const countSnap = await getCountFromServer(
            query(collection(db, "listings"), where("categoryId", "==", b.id))
          );
          if (!cancelled) setTotalCount(countSnap.data().count);
        } catch (e) {
          // rules / izin yoksa count çalışmayabilir
        }
      } catch (e: any) {
        devError("Category page load error", e);
        if (!cancelled) {
          setError(getFriendlyErrorMessage(e, "Bir hata oluştu."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAll();

    return () => {
      cancelled = true;
    };
  }, [categorySlug]);

  /* ================= MODEL COUNTS (popülerlik) ================= */

  const subCategoryCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    listingsRaw.forEach((l) => {
      if (!l.subCategoryId) return;
      acc[l.subCategoryId] = (acc[l.subCategoryId] || 0) + 1;
    });
    return acc;
  }, [listingsRaw]);

  const popularSubCategories = useMemo(() => {
    const arr = [...subCategories];
    arr.sort((a, b) => {
      const ac = subCategoryCounts[a.id] || 0;
      const bc = subCategoryCounts[b.id] || 0;
      if (bc !== ac) return bc - ac;
      return (a.nameLower || a.name).localeCompare(b.nameLower || b.name, "tr");
    });
    return arr;
  }, [subCategories, subCategoryCounts]);

  /* ================= FILTER + SORT + LIMIT ================= */

  const filteredListings = useMemo(() => {
    const minP = toNumOrNull(minPrice);
    const maxP = toNumOrNull(maxPrice);

    const yMin = toIntOrNull(yearMin);
    const yMax = toIntOrNull(yearMax);

    const g = normTR(gender);
    const q = normTR(searchDebounced);

    return listingsRaw.filter((l) => {
      // subCategory
      if (subCategoryId) {
        if ((l.subCategoryId || "") !== subCategoryId) return false;
      }

      // search
      if (q) {
        const hay = `${l.title || ""} ${l.subCategoryName || ""} ${l.categoryName || ""}`
          .toLocaleLowerCase("tr-TR")
          .trim();
        if (!hay.includes(q)) return false;
      }

      // price
      const p = Number(l.price);
      const pOk = Number.isFinite(p);
      if (minP !== null) {
        if (!pOk || p < minP) return false;
      }
      if (maxP !== null) {
        if (!pOk || p > maxP) return false;
      }

      // year
      const y = getYearNumber(l.productionYear);
      if (yMin !== null) {
        if (y === null || y < yMin) return false;
      }
      if (yMax !== null) {
        if (y === null || y > yMax) return false;
      }

      // gender
      if (g) {
        const lg = normTR(l.gender || "");
        if (!lg) return false;
        if (lg !== g) return false;
      }

      // wear
      if (wearFilter === "wear") {
        if (l.wearExists !== true) return false;
      }
      if (wearFilter === "noWear") {
        if (l.wearExists !== false) return false;
      }

      return true;
    });
  }, [
    listingsRaw,
    subCategoryId,
    minPrice,
    maxPrice,
    yearMin,
    yearMax,
    gender,
    wearFilter,
    searchDebounced,
  ]);

  const sortedListings = useMemo(() => {
    const arr = [...filteredListings];

    if (sortMode === "newest") {
      arr.sort((a, b) => {
        const ad = a.createdAt?.toDate?.()?.getTime?.() ?? 0;
        const bd = b.createdAt?.toDate?.()?.getTime?.() ?? 0;
        return bd - ad;
      });
      return arr;
    }

    if (sortMode === "priceAsc") {
      arr.sort((a, b) => {
        const ap = Number(a.price);
        const bp = Number(b.price);
        const aok = Number.isFinite(ap) ? ap : Number.POSITIVE_INFINITY;
        const bok = Number.isFinite(bp) ? bp : Number.POSITIVE_INFINITY;
        return aok - bok;
      });
      return arr;
    }

    if (sortMode === "priceDesc") {
      arr.sort((a, b) => {
        const ap = Number(a.price);
        const bp = Number(b.price);
        const aok = Number.isFinite(ap) ? ap : Number.NEGATIVE_INFINITY;
        const bok = Number.isFinite(bp) ? bp : Number.NEGATIVE_INFINITY;
        return bok - aok;
      });
      return arr;
    }

    return arr;
  }, [filteredListings, sortMode]);

  const visibleListings = useMemo(() => {
    return sortedListings.slice(0, pageSize);
  }, [sortedListings, pageSize]);

  // ✅ kullanıcı daha fazla isterse, ham veriyi de büyüt
  useEffect(() => {
    if (!category?.id) return;
    if (!hasMore) return;
    if (loadingMore) return;

    // pageSize > listingsRaw.length ise Firestore’dan yeni sayfa çek
    if (pageSize > listingsRaw.length) {
      fetchMore(category.id);
    }
  }, [pageSize, listingsRaw.length, category?.id, hasMore, loadingMore]);

  /* ================= PRESETS (Hızlı Filtreler) ================= */

  const applyPreset = (p: string) => {
    if (p === "year2020") {
      setYearMin("2020");
      setYearMax("");
      setSortMode("newest");
      return;
    }
    if (p === "noWear") {
      setWearFilter("noWear");
      return;
    }
    if (p === "under50") {
      setMinPrice("");
      setMaxPrice("50000");
      setSortMode("priceAsc");
      return;
    }
  };

  const scrollSubCategories = (dir: "left" | "right") => {
    const el = subScrollRef.current;
    if (!el) return;
    const amount = el.clientWidth;
    el.scrollBy({
      left: dir === "left" ? -amount : amount,
      behavior: "smooth",
    });
  };

  const filterVisibility = useMemo(() => {
    const hasYear = listingsRaw.some((l) => getYearNumber(l.productionYear) !== null);
    const hasGender = listingsRaw.some((l) => normalizeSpaces(l.gender || ""));
    const hasWear = listingsRaw.some(
      (l) => l.wearExists === true || l.wearExists === false
    );
    return {
      showYear: hasYear,
      showGender: hasGender,
      showWear: hasWear,
    };
  }, [listingsRaw]);

  useEffect(() => {
    if (!filterVisibility.showYear && (yearMin || yearMax)) {
      setYearMin("");
      setYearMax("");
    }
    if (!filterVisibility.showGender && gender) {
      setGender("");
    }
    if (!filterVisibility.showWear && wearFilter) {
      setWearFilter("");
    }
  }, [
    filterVisibility.showYear,
    filterVisibility.showGender,
    filterVisibility.showWear,
    yearMin,
    yearMax,
    gender,
    wearFilter,
  ]);

  /* ================= ACTIVE FILTER BADGES ================= */

  const selectedSubCategory = subCategoryId ? subCategories.find((m) => m.id === subCategoryId) : null;

  /* ================= UI STATES ================= */

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f7f4ef] px-4 py-10">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="bg-white/90 rounded-3xl border border-slate-200/70 shadow-sm p-8 animate-pulse">
            <div className="h-6 w-60 bg-slate-200 rounded mb-3" />
            <div className="h-4 w-96 bg-slate-200 rounded" />
          </div>

          <div className="bg-white/90 rounded-3xl border border-slate-200/70 shadow-sm p-6 animate-pulse">
            <div className="h-5 w-40 bg-slate-200 rounded mb-4" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-64 bg-slate-200 rounded-2xl" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#f7f4ef] px-4 py-10">
        <div className="max-w-3xl mx-auto bg-white/90 rounded-3xl border border-slate-200/70 shadow-sm p-8 text-center">
          <div className="text-rose-700 font-semibold mb-2">Hata</div>
          <div className="text-slate-700 mb-6">{error}</div>
          <button
            onClick={() => router.push("/")}
            className="underline text-emerald-700"
          >
            Ana sayfaya dön
          </button>
        </div>
      </div>
    );
  }

  if (!category) return null;

  const loadedCount = listingsRaw.length;
  const totalShow = totalCount === null ? `${loadedCount}` : `${totalCount}`;

  /* ================= UI ================= */

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
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-28 -right-24 h-80 w-80 rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="absolute top-20 -left-24 h-72 w-72 rounded-full bg-amber-200/40 blur-3xl" />
      </div>
      <div
        className={`${sora.className} relative z-10 mx-auto max-w-7xl px-4 py-8 sm:py-12 space-y-8`}
      >
        {/* ================= BREADCRUMB ================= */}
        <div className="flex flex-wrap items-center gap-2 text-base sm:text-lg font-semibold text-[color:var(--market-ink)]">
          <Link href="/" className="hover:opacity-80 transition">
            Ana sayfa
          </Link>
          <span className="opacity-40">/</span>
          <span>
            {category.name}{" "}
            <span className="text-[color:var(--market-muted)] font-normal">({totalShow})</span>
          </span>
        </div>

        {/* ================= SUBCATEGORY CAROUSEL ================= */}
        {subCategories.length > 0 && (
          <div className="rounded-2xl border border-slate-200/70 bg-white/90 shadow-sm p-4 sm:p-5 backdrop-blur">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-slate-900">
                Alt kategoriler
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => scrollSubCategories("left")}
                  className="h-9 w-9 rounded-full border border-slate-200 bg-white hover:bg-slate-50"
                  aria-label="Sola kaydır"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => scrollSubCategories("right")}
                  className="h-9 w-9 rounded-full border border-slate-200 bg-white hover:bg-slate-50"
                  aria-label="Sağa kaydır"
                >
                  ›
                </button>
              </div>
            </div>

            <div ref={subScrollRef} className="no-scrollbar overflow-x-auto">
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setSubCategoryId("")}
                  className={`shrink-0 rounded-2xl border px-4 py-4 text-left transition w-[calc((100%-16px)/2)] sm:w-[calc((100%-48px)/4)] ${
                    subCategoryId === ""
                      ? "bg-emerald-50 text-emerald-700 font-semibold border-emerald-200"
                      : "bg-white hover:bg-slate-50 border-slate-200"
                  }`}
                >
                  <div className="text-xs uppercase tracking-wide text-[color:var(--market-muted)]">
                    Tümü
                  </div>
                  <div className="mt-1 text-base font-semibold">
                    {category.name}
                  </div>
                </button>

                {subCategories.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSubCategoryId(m.id)}
                    className={`shrink-0 rounded-2xl border px-4 py-4 text-left transition w-[calc((100%-16px)/2)] sm:w-[calc((100%-48px)/4)] ${
                      subCategoryId === m.id
                        ? "bg-emerald-50 text-emerald-700 font-semibold border-emerald-200"
                        : "bg-white hover:bg-slate-50 border-slate-200"
                    }`}
                  >
                    <div className="text-xs uppercase tracking-wide text-[color:var(--market-muted)]">
                      Alt kategori
                    </div>
                    <div className="mt-1 text-sm font-semibold line-clamp-2">
                      {m.name}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ================= TOOLBAR (INLINE FILTERS) ================= */}
        {/* ================= TOOLBAR (INLINE FILTERS) ================= */}
        <div className="rounded-2xl border border-slate-200/70 bg-white/90 shadow-sm p-4 sm:p-5 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-xs text-slate-600 shrink-0">
              <span>G?steriliyor</span>
              <span className="font-semibold text-slate-900">
                {Math.min(visibleListings.length, sortedListings.length)}
              </span>
              <span className="text-slate-400">/</span>
              <span>{sortedListings.length}</span>
            </div>

            {appliedFiltersCount > 0 && (
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-xs text-emerald-700 shrink-0">
                Filtre: <span className="font-semibold">{appliedFiltersCount}</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              className="md:hidden inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shrink-0"
            >
              Filtreler
              <svg
                className={`w-3.5 h-3.5 transition ${filtersOpen ? "rotate-180" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </button>

            <div className="ml-auto flex items-center gap-2">
              {category?.id && hasMore && (
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => fetchMore(category.id)}
                  className={`rounded-full border border-slate-200 bg-white px-3 py-2 text-xs shrink-0 ${loadingMore ? "opacity-60 cursor-not-allowed" : "hover:bg-slate-50"}`}
                >
                  {loadingMore ? "Y?kleniyor..." : "Daha fazla ilan y?kle"}
                </button>
              )}

              <div className="flex rounded-xl border border-slate-200 overflow-hidden bg-white shrink-0">
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  className={`px-3 py-2 text-sm ${viewMode === "grid" ? "bg-emerald-50 text-emerald-700 font-semibold" : "hover:bg-slate-50"}`}
                >
                  Grid
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={`px-3 py-2 text-sm ${viewMode === "list" ? "bg-emerald-50 text-emerald-700 font-semibold" : "hover:bg-slate-50"}`}
                >
                  Liste
                </button>
              </div>
            </div>
          </div>

          <div className="mt-3 hidden md:flex md:flex-wrap md:items-center gap-2">
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm min-w-[220px]"
              placeholder="Ara..."
            />
            <input
              value={minPrice}
              onChange={(e) => setMinPrice(cleanDigits(e.target.value))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm w-24"
              placeholder="Min (?)"
              inputMode="numeric"
            />
            <input
              value={maxPrice}
              onChange={(e) => setMaxPrice(cleanDigits(e.target.value))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm w-24"
              placeholder="Max (?)"
              inputMode="numeric"
            />
            {filterVisibility.showYear && (
              <>
                <select
                  value={yearMin}
                  onChange={(e) => setYearMin(cleanDigits(e.target.value))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm w-28"
                >
                  <option value="">Y?l min</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <select
                  value={yearMax}
                  onChange={(e) => setYearMax(cleanDigits(e.target.value))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm w-28"
                >
                  <option value="">Y?l max</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </>
            )}
            {filterVisibility.showGender && (
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm min-w-[120px]"
              >
                <option value="">Cinsiyet</option>
                {genderOptions.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            )}
            {filterVisibility.showWear && (
              <select
                value={wearFilter}
                onChange={(e) => setWearFilter(e.target.value as any)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm min-w-[140px]"
              >
                <option value="">A??nma</option>
                <option value="wear">A??nma var</option>
                <option value="noWear">A??nma yok</option>
              </select>
            )}
            <select
              value={sortMode}
              onChange={(e) =>
                setSortMode(e.target.value as "newest" | "priceAsc" | "priceDesc")
              }
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm min-w-[140px]"
            >
              <option value="newest">En yeni</option>
              <option value="priceAsc">Fiyat (artan)</option>
              <option value="priceDesc">Fiyat (azalan)</option>
            </select>
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 shrink-0"
            >
              S?f?rla
            </button>
            {filterVisibility.showYear && (
              <button
                type="button"
                onClick={() => applyPreset("year2020")}
                className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 shrink-0"
              >
                2020+
              </button>
            )}
            {filterVisibility.showWear && (
              <button
                type="button"
                onClick={() => applyPreset("noWear")}
                className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 shrink-0"
              >
                A??nma yok
              </button>
            )}
          </div>

          {filtersOpen && (
            <div className="mt-3 flex items-center gap-2 overflow-x-auto no-scrollbar flex-nowrap pb-1 md:hidden">
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm min-w-[220px]"
                placeholder="Ara..."
              />
              <input
                value={minPrice}
                onChange={(e) => setMinPrice(cleanDigits(e.target.value))}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm w-24"
                placeholder="Min (?)"
                inputMode="numeric"
              />
              <input
                value={maxPrice}
                onChange={(e) => setMaxPrice(cleanDigits(e.target.value))}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm w-24"
                placeholder="Max (?)"
                inputMode="numeric"
              />
              {filterVisibility.showYear && (
                <>
                  <select
                    value={yearMin}
                    onChange={(e) => setYearMin(cleanDigits(e.target.value))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm w-28"
                  >
                    <option value="">Y?l min</option>
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                  <select
                    value={yearMax}
                    onChange={(e) => setYearMax(cleanDigits(e.target.value))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm w-28"
                  >
                    <option value="">Y?l max</option>
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {filterVisibility.showGender && (
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm min-w-[120px]"
                >
                  <option value="">Cinsiyet</option>
                  {genderOptions.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              )}
              {filterVisibility.showWear && (
                <select
                  value={wearFilter}
                  onChange={(e) => setWearFilter(e.target.value as any)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm min-w-[140px]"
                >
                  <option value="">A??nma</option>
                  <option value="wear">A??nma var</option>
                  <option value="noWear">A??nma yok</option>
                </select>
              )}
              <select
                value={sortMode}
                onChange={(e) =>
                  setSortMode(e.target.value as "newest" | "priceAsc" | "priceDesc")
                }
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm min-w-[140px]"
              >
                <option value="newest">En yeni</option>
                <option value="priceAsc">Fiyat (artan)</option>
                <option value="priceDesc">Fiyat (azalan)</option>
              </select>
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 shrink-0"
              >
                S?f?rla
              </button>
            </div>
          )}
        </div>

        {/* ================= LISTINGS ================= */}
        {visibleListings.length === 0 ? (
          <div className="rounded-3xl border border-slate-200/70 bg-white/90 p-8 text-center shadow-sm">
            <div className="text-gray-900 font-semibold">
              Bu filtrelere uygun ilan bulunamadı.
            </div>
            <div className="text-sm text-[color:var(--market-muted)] mt-1">
              Filtreleri gevşetebilir veya daha fazla ilan yükleyebilirsin.
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center mt-4">
              <button
                type="button"
                onClick={clearFilters}
                className="bg-slate-900 hover:bg-black text-white font-semibold px-6 py-3 rounded-xl"
              >
                Filtreleri sıfırla
              </button>

              {category?.id && hasMore && (
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => fetchMore(category.id)}
                  className={`border border-slate-200 rounded-xl px-6 py-3 font-semibold ${
                    loadingMore ? "opacity-60 cursor-not-allowed" : "hover:bg-slate-50"
                  }`}
                >
                  {loadingMore ? "Yükleniyor..." : "Daha fazla ilan yükle"}
                </button>
              )}
            </div>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {visibleListings.map((l) => {
              const img = firstImage(l.imageUrls);
              const ago = timeAgoTR(l.createdAt);
              const y = getYearNumber(l.productionYear);

              return (
                <Link
                  key={l.id}
                  href={buildListingPath(l.id, l.title)}
                  prefetch={false}
                  className="group block"
                >
                  <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
                    <div className="relative h-44 sm:h-52 bg-slate-100">
                      {img ? (
                        <Image
                          src={img}
                          alt={safeText(l.title, "ilan")}
                          fill
                          sizes="(max-width: 640px) 75vw, (max-width: 1024px) 40vw, 300px"
                          className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                          quality={45}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
                          Görsel yok
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-900/25 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition" />
                    </div>

                    <div className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-semibold text-gray-900 line-clamp-2">
                          {safeText(l.title, "İlan")}
                        </div>
                        <div className="shrink-0 text-lg font-semibold text-emerald-700">
                          {formatPriceTRY(l.price)}
                        </div>
                      </div>

                      <div className="text-xs text-[color:var(--market-muted)] flex items-center justify-between gap-2">
                        <div className="truncate">
                          {safeText(l.categoryName, category.name)}
                          {l.subCategoryName ? ` / ${l.subCategoryName}` : ""}
                        </div>
                        <div className="shrink-0">{ago}</div>
                      </div>

                      <div className="text-[11px] text-slate-600 flex flex-wrap gap-2">
                        {y ? (
                          <span className="px-2 py-1 rounded-full bg-slate-100">
                            {y}
                          </span>
                        ) : null}
                        {l.gender ? (
                          <span className="px-2 py-1 rounded-full bg-slate-100">
                            {compactLabel(l.gender)}
                          </span>
                        ) : null}
                        {l.wearExists === true ? (
                          <span className="px-2 py-1 rounded-full bg-rose-50 text-rose-700">
                            Aşınma var
                          </span>
                        ) : l.wearExists === false ? (
                          <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">
                            Aşınma yok
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="rounded-3xl border border-slate-200/70 bg-white/90 shadow-sm overflow-hidden">
            <div className="divide-y divide-slate-100">
              {visibleListings.map((l) => {
                const img = firstImage(l.imageUrls);
                const ago = timeAgoTR(l.createdAt);
                const y = getYearNumber(l.productionYear);

                return (
                  <Link
                    key={l.id}
                    href={buildListingPath(l.id, l.title)}
                    prefetch={false}
                    className="block hover:bg-slate-50 transition"
                  >
                    <div className="p-4 sm:p-5 flex flex-col sm:flex-row gap-4">
                      <div className="relative w-full sm:w-40 h-28 rounded-2xl overflow-hidden bg-slate-100 flex items-center justify-center text-slate-400 text-xs shrink-0">
                        {img ? (
                        <Image
                          src={img}
                          alt={safeText(l.title, "ilan")}
                          fill
                          sizes="(max-width: 640px) 92vw, 160px"
                          className="object-cover"
                          quality={45}
                        />
                        ) : (
                          "Görsel yok"
                        )}
                      </div>

                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="font-semibold text-gray-900 truncate">
                            {safeText(l.title, "İlan")}
                          </div>
                          <div className="text-lg font-semibold text-emerald-700 shrink-0">
                            {formatPriceTRY(l.price)}
                          </div>
                        </div>

                        <div className="text-xs text-[color:var(--market-muted)] flex items-center justify-between gap-2">
                          <div className="truncate">
                            {category.name}
                            {l.subCategoryName ? ` / ${l.subCategoryName}` : ""}
                          </div>
                          <div className="shrink-0">{ago}</div>
                        </div>

                        <div className="text-[11px] text-slate-600 flex flex-wrap gap-2">
                          {y ? <span className="px-2 py-1 rounded-full bg-slate-100">{y}</span> : null}
                          {l.gender ? (
                            <span className="px-2 py-1 rounded-full bg-slate-100">
                              {compactLabel(l.gender)}
                            </span>
                          ) : null}
                          {l.wearExists === true ? (
                            <span className="px-2 py-1 rounded-full bg-rose-50 text-rose-700">
                              Aşınma var
                            </span>
                          ) : l.wearExists === false ? (
                            <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">
                              Aşınma yok
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* ================= LOAD MORE UX ================= */}
        <div className="flex flex-col items-center gap-2">
          {sortedListings.length > visibleListings.length && (
            <button
              type="button"
              onClick={() => setPageSize((p) => p + 24)}
              className="bg-slate-900 hover:bg-black text-white font-semibold px-6 py-3 rounded-xl shadow-sm"
            >
              Daha fazla göster
            </button>
          )}

          {category?.id && hasMore && (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => fetchMore(category.id)}
              className={`border border-slate-200 rounded-xl px-6 py-3 font-semibold ${
                loadingMore ? "opacity-60 cursor-not-allowed" : "hover:bg-slate-50"
              }`}
            >
              {loadingMore ? "Yükleniyor..." : "Firestore'dan yeni ilanlar yükle"}
            </button>
          )}

          {!hasMore && (
            <div className="text-xs text-[color:var(--market-muted)]">
              Tüm ilanlar yüklendi ✅
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
