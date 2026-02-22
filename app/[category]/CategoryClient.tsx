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
import { getCategoriesCached } from "@/lib/catalogCache";
import { devError, getFriendlyErrorMessage } from "@/lib/logger";
import { buildListingPath, slugifyTR } from "@/lib/listingUrl";
import { isPublicListingVisible } from "@/lib/listingVisibility";

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
  status?: string;
  adminStatus?: string;
  conditionKey?: string;
  conditionLabel?: string;
  isTradable?: boolean;
  shippingAvailable?: boolean;
  isShippable?: boolean;

  categoryId?: string;
  categoryName?: string;

  subCategoryId?: string;
  subCategoryName?: string;
  locationCity?: string | null;
  locationDistrict?: string | null;

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

const formatRegion = (city?: string | null, district?: string | null) => {
  const cleanCity = normalizeSpaces(city || "");
  const cleanDistrict = normalizeSpaces(district || "");
  if (cleanCity && cleanDistrict) return `${cleanDistrict} / ${cleanCity}`;
  return cleanCity || cleanDistrict || "";
};

const normTR = (v?: string) =>
  normalizeSpaces(v || "").toLocaleLowerCase("tr-TR");

const normTRAscii = (v?: string) =>
  normTR(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
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

const toNumOrNull = (v: string) => {
  const t = (v || "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const compactLabel = (s?: string) => {
  const t = normalizeSpaces(s || "");
  return t.length > 18 ? t.slice(0, 18) + "..." : t;
};

const clampInt = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.trunc(n)));

const pickEnum = (v: string | null, allowed: string[]) => {
  if (!v) return "";
  return allowed.includes(v) ? v : "";
};

const cleanDigits = (v: string) => (v || "").replace(/[^\d]/g, "");

const CONDITION_OPTIONS = [
  { value: "new", label: "Yeni / Açılmamış" },
  { value: "likeNew", label: "Çok İyi (Sıfır Ayarında)" },
  { value: "good", label: "İyi" },
  { value: "used", label: "Kullanılmış" },
  { value: "forParts", label: "Parça / Arızalı" },
] as const;

const getConditionKey = (listing: Listing) =>
  normalizeSpaces(listing.conditionKey || "").trim();

const getConditionLabel = (listing: Listing) => {
  const explicit = normalizeSpaces(listing.conditionLabel || "");
  if (explicit) return explicit;
  const key = getConditionKey(listing);
  const match = CONDITION_OPTIONS.find((item) => item.value === key);
  return match?.label || "";
};

const toBoolLike = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const v = value.trim().toLocaleLowerCase("tr-TR");
    if (!v) return undefined;
    if (
      ["true", "1", "yes", "evet", "var", "uygun", "acik", "açık"].includes(v)
    ) {
      return true;
    }
    if (
      ["false", "0", "no", "hayir", "hayır", "yok", "uygun degil", "uygun değil", "kapali", "kapalı"].includes(v)
    ) {
      return false;
    }
  }
  return undefined;
};

const getTradableValue = (listing: Listing) => {
  const root = toBoolLike((listing as any).isTradable);
  if (root !== undefined) return root;

  const attrs = (listing as any).attributes || {};
  const fromAttrs =
    toBoolLike(attrs.isTradable) ??
    toBoolLike(attrs.tradable) ??
    toBoolLike(attrs.isTradableBool);
  if (fromAttrs !== undefined) return fromAttrs;

  return undefined;
};

const getShippingValue = (listing: Listing) => {
  const root =
    toBoolLike((listing as any).shippingAvailable) ??
    toBoolLike((listing as any).isShippable);
  if (root !== undefined) return root;

  const attrs = (listing as any).attributes || {};
  const fromAttrs =
    toBoolLike(attrs.shippingAvailable) ??
    toBoolLike(attrs.isShippable) ??
    toBoolLike(attrs.kargoUygun) ??
    toBoolLike(attrs.shipping);
  if (fromAttrs !== undefined) return fromAttrs;

  return undefined;
};

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
  const visibleInitialListings = initialListings.filter((item) =>
    isPublicListingVisible(item)
  );

  /* ================= DATA ================= */

  const [category, setCategory] = useState<Category | null>(initialCategory);
  const [subCategories, setSubCategories] = useState<SubCategory[]>(
    initialSubCategories
  );

  // ✅ Pagination ile yüklenen ham ilanlar
  const [listingsRaw, setListingsRaw] = useState<Listing[]>(
    visibleInitialListings
  );
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

  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [conditionFilter, setConditionFilter] = useState("");
  const [tradableFilter, setTradableFilter] = useState<"" | "yes" | "no">("");
  const [shippingFilter, setShippingFilter] = useState<"" | "yes" | "no">("");

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
    const minP = searchParams.get("minPrice") || "";
    const maxP = searchParams.get("maxPrice") || "";
    const cond = searchParams.get("condition") || "";
    const tradable = pickEnum(searchParams.get("tradable"), ["yes", "no"]);
    const shipping = pickEnum(searchParams.get("shipping"), ["yes", "no"]);

    const sort = (searchParams.get("sort") || "newest") as
      | "newest"
      | "priceAsc"
      | "priceDesc";

    const view = (searchParams.get("view") || "grid") as "grid" | "list";

    setSearchText(q);

    setMinPrice(cleanDigits(minP));
    setMaxPrice(cleanDigits(maxP));

    setConditionFilter(
      pickEnum(
        cond,
        CONDITION_OPTIONS.map((item) => item.value as string)
      )
    );
    setTradableFilter((tradable as "" | "yes" | "no") || "");
    setShippingFilter((shipping as "" | "yes" | "no") || "");

    setSortMode(sort);
    setViewMode(view);

    // UX: linkten gelince "her şey gelsin" diye 24 bırakıyoruz (istersen 48 yap)
    setPageSize(24);

    didInitFromUrl.current = true;
  }, [categorySlug, searchParams]);

  /* ================= URL SYNC (STATE → URL) ================= */

  useEffect(() => {
    if (!didInitFromUrl.current) return;
    if (!pathname) return;

    const sp = new URLSearchParams();

    if (searchText.trim()) sp.set("q", searchText.trim());
    if (minPrice.trim()) sp.set("minPrice", minPrice.trim());
    if (maxPrice.trim()) sp.set("maxPrice", maxPrice.trim());

    if (conditionFilter) sp.set("condition", conditionFilter);
    if (tradableFilter) sp.set("tradable", tradableFilter);
    if (shippingFilter) sp.set("shipping", shippingFilter);

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
    minPrice,
    maxPrice,
    conditionFilter,
    tradableFilter,
    shippingFilter,
    sortMode,
    viewMode,
  ]);

  /* ================= FILTER UTIL ================= */

  const clearFilters = () => {
    setMinPrice("");
    setMaxPrice("");
    setConditionFilter("");
    setTradableFilter("");
    setShippingFilter("");
    setSearchText("");
    setSortMode("newest");
    setViewMode("grid");
    setPageSize(24);
  };

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string }> = [];
    const search = searchText.trim();
    const minP = minPrice.trim();
    const maxP = maxPrice.trim();
    const condition = conditionFilter.trim();

    if (search) chips.push({ key: "search", label: `Arama: ${search}` });
    if (minP || maxP) {
      chips.push({
        key: "price",
        label: `Fiyat: ${minP || "0"} - ${maxP || "sonsuz"}`,
      });
    }
    if (condition) {
      const label =
        CONDITION_OPTIONS.find((item) => item.value === condition)?.label || condition;
      chips.push({ key: "condition", label: `Durum: ${label}` });
    }
    if (tradableFilter) {
      chips.push({
        key: "tradable",
        label: tradableFilter === "yes" ? "Takas: Evet" : "Takas: Hayır",
      });
    }
    if (shippingFilter) {
      chips.push({
        key: "shipping",
        label: shippingFilter === "yes" ? "Kargo: Uygun" : "Kargo: Uygun değil",
      });
    }

    return chips;
  }, [
    searchText,
    minPrice,
    maxPrice,
    conditionFilter,
    tradableFilter,
    shippingFilter,
  ]);

  const appliedFiltersCount = activeFilterChips.length;

  const clearFilterByKey = (key: string) => {
    if (key === "search") setSearchText("");
    if (key === "price") {
      setMinPrice("");
      setMaxPrice("");
    }
    if (key === "condition") setConditionFilter("");
    if (key === "tradable") setTradableFilter("");
    if (key === "shipping") setShippingFilter("");
  };

  useEffect(() => {
    if (appliedFiltersCount > 0) setFiltersOpen(true);
  }, [appliedFiltersCount]);

  // Legacy URL desteği: /[category]?subCategoryId=... -> /[category]/[subCategory]
  useEffect(() => {
    const rawLegacySub = (searchParams.get("subCategoryId") || "").trim();
    if (!rawLegacySub) return;
    if (!category || subCategories.length === 0) return;

    const legacyNorm = normTRAscii(rawLegacySub);
    const legacySlug = slugifyTR(rawLegacySub);

    const matchSub = subCategories.find((m) => {
      const normKeys = [m.id, m.nameLower, m.name].map((x) => normTRAscii(String(x || "")));
      const slugKeys = [m.id, m.nameLower, m.name].map((x) => slugifyTR(String(x || "")));
      return normKeys.includes(legacyNorm) || slugKeys.includes(legacySlug);
    });

    const cleanParams = new URLSearchParams(searchParams.toString());
    cleanParams.delete("subCategoryId");
    const qs = cleanParams.toString();

    const categoryPath = `/${encodeURIComponent(
      slugifyTR(category.nameLower || category.name || "")
    )}`;

    if (matchSub) {
      const subSlug = slugifyTR(matchSub.nameLower || matchSub.name || "");
      const nextPath = `${categoryPath}/${encodeURIComponent(subSlug)}`;
      router.replace(qs ? `${nextPath}?${qs}` : nextPath);
      return;
    }

    router.replace(qs ? `${categoryPath}?${qs}` : categoryPath);
  }, [searchParams, category, subCategories, router]);

  /* ================= LOAD BRAND + MODELS + LISTINGS (PAGINATION) ================= */

  const LISTINGS_BATCH = 60;
  const isIndexError = (e: any) =>
    String(e?.message || "").includes("requires an index");

  const fetchCategoryBatch = async (
    categoryId: string,
    startAfterDoc: QueryDocumentSnapshot<DocumentData> | null
  ) => {
    try {
      const constraints: any[] = [
        where("categoryId", "==", categoryId),
        where("status", "==", "active"),
        orderBy("createdAt", "desc"),
        limit(LISTINGS_BATCH),
      ];
      if (startAfterDoc) constraints.splice(3, 0, startAfter(startAfterDoc));

      const snap = await getDocs(query(collection(db, "listings"), ...constraints));
      const docs = snap.docs;
      const items = docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((item) => isPublicListingVisible(item as Listing)) as Listing[];

      return {
        items,
        lastDoc: docs.length > 0 ? docs[docs.length - 1] : startAfterDoc,
        hasMore: docs.length === LISTINGS_BATCH,
      };
    } catch (e: any) {
      if (!isIndexError(e)) throw e;

      // Fallback: izin uyumluluğu için status=="active" filtresini koru.
      // createdAt orderBy indexsiz çalışmayabilir; bu durumda ilk batch'i orderBy'sız çekeriz.
      if (startAfterDoc) {
        return {
          items: [],
          lastDoc: startAfterDoc,
          hasMore: false,
        };
      }

      const snap = await getDocs(
        query(
          collection(db, "listings"),
          where("categoryId", "==", categoryId),
          where("status", "==", "active"),
          limit(LISTINGS_BATCH)
        )
      );
      const docs = snap.docs;
      const collected = docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((item) => isPublicListingVisible(item as Listing)) as Listing[];

      collected.sort((a, b) => {
        const ad = a.createdAt?.toDate?.()?.getTime?.() ?? 0;
        const bd = b.createdAt?.toDate?.()?.getTime?.() ?? 0;
        return bd - ad;
      });

      return {
        items: collected,
        lastDoc: docs.length > 0 ? docs[docs.length - 1] : startAfterDoc,
        hasMore: false,
      };
    }
  };

  const fetchFirstPage = async (categoryId: string) => {
    const batch = await fetchCategoryBatch(categoryId, null);
    setCursor(batch.lastDoc);
    setHasMore(batch.hasMore);
    setListingsRaw(batch.items);
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
      const batch = await fetchCategoryBatch(categoryId, cursor);
      setCursor(batch.lastDoc || cursor);
      setHasMore(batch.hasMore);

      // merge unique
      setListingsRaw((prev) => {
        const map = new Map<string, Listing>();
        for (const x of prev) map.set(x.id, x);
        for (const x of batch.items) map.set(x.id, x);
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
    if (initialCategory) return;

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
        const slugKey = slugifyTR(categorySlug);
        const matchCategory = categoryDocs.find((c) => {
          const keys = [c.id, c.slug, c.nameLower, c.name].map((x) =>
            normTRAscii(x)
          );
          const slugs = [c.slug, c.nameLower, c.name].map((x) =>
            slugifyTR(String(x || ""))
          );
          return keys.includes(key) || slugs.includes(slugKey);
        });

        if (!matchCategory) throw new Error("Kategori bulunamadi.");

        const canonicalCategorySlug = slugifyTR(
          matchCategory.slug || matchCategory.nameLower || matchCategory.name || ""
        );
        const currentSlugRaw = (categorySlug || "").trim();
        if (canonicalCategorySlug && currentSlugRaw !== canonicalCategorySlug) {
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
        const subDocs = categoryDocs.filter((s: any) => s.parentId === b.id);

        if (cancelled) return;

        const ms = subDocs
          .map((d: any) => ({
            id: d.id,
            name: d.name,
            nameLower: d.nameLower,
            categoryId: d.parentId || undefined,
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
            query(
              collection(db, "listings"),
              where("categoryId", "==", b.id),
              where("status", "==", "active")
            )
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
    const q = normTR(searchDebounced);

    return listingsRaw.filter((l) => {
      if (q) {
        const hay = `${l.title || ""} ${l.subCategoryName || ""} ${l.categoryName || ""}`
          .toLocaleLowerCase("tr-TR")
          .trim();
        if (!hay.includes(q)) return false;
      }

      const p = Number(l.price);
      const pOk = Number.isFinite(p);
      if (minP !== null && (!pOk || p < minP)) return false;
      if (maxP !== null && (!pOk || p > maxP)) return false;

      if (conditionFilter) {
        if (getConditionKey(l) !== conditionFilter) return false;
      }

      if (tradableFilter) {
        const tradable = getTradableValue(l);
        if (tradableFilter === "yes" && tradable !== true) return false;
        if (tradableFilter === "no" && tradable !== false) return false;
      }

      if (shippingFilter) {
        const shipping = getShippingValue(l);
        if (shippingFilter === "yes" && shipping !== true) return false;
        if (shippingFilter === "no" && shipping !== false) return false;
      }

      return true;
    });
  }, [
    listingsRaw,
    minPrice,
    maxPrice,
    conditionFilter,
    tradableFilter,
    shippingFilter,
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

    // Filtrelenmiş sonuçlar sayfayı doldurmuyorsa da yeni sayfa çek.
    if (pageSize > listingsRaw.length || sortedListings.length < pageSize) {
      fetchMore(category.id);
    }
  }, [
    pageSize,
    listingsRaw.length,
    sortedListings.length,
    category?.id,
    hasMore,
    loadingMore,
  ]);

  /* ================= PRESETS (Hızlı Filtreler) ================= */

  const applyPreset = (preset: "tradableYes" | "shippingYes") => {
    if (preset === "tradableYes") {
      setTradableFilter((prev) => (prev === "yes" ? "" : "yes"));
      return;
    }
    if (preset === "shippingYes") {
      setShippingFilter((prev) => (prev === "yes" ? "" : "yes"));
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
    const hasCondition = listingsRaw.some((l) => !!getConditionKey(l));
    const hasTradable = true;
    const hasShipping = true;

    return {
      showCondition: hasCondition,
      showTradable: hasTradable,
      showShipping: hasShipping,
    };
  }, [listingsRaw]);

  useEffect(() => {
    if (!filterVisibility.showCondition && conditionFilter) {
      setConditionFilter("");
    }
    if (!filterVisibility.showTradable && tradableFilter) {
      setTradableFilter("");
    }
    if (!filterVisibility.showShipping && shippingFilter) {
      setShippingFilter("");
    }
  }, [
    filterVisibility.showCondition,
    filterVisibility.showTradable,
    filterVisibility.showShipping,
    conditionFilter,
    tradableFilter,
    shippingFilter,
  ]);

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
  const canonicalCategorySlug = slugifyTR(category.nameLower || category.name || "");
  const canonicalCategoryPath = `/${encodeURIComponent(canonicalCategorySlug)}`;

  const routeQuery = (() => {
    const sp = new URLSearchParams();
    if (searchText.trim()) sp.set("q", searchText.trim());
    if (minPrice.trim()) sp.set("minPrice", minPrice.trim());
    if (maxPrice.trim()) sp.set("maxPrice", maxPrice.trim());
    if (conditionFilter) sp.set("condition", conditionFilter);
    if (tradableFilter) sp.set("tradable", tradableFilter);
    if (shippingFilter) sp.set("shipping", shippingFilter);
    if (sortMode !== "newest") sp.set("sort", sortMode);
    if (viewMode !== "grid") sp.set("view", viewMode);
    return sp.toString();
  })();

  const categoryHref = routeQuery
    ? `${canonicalCategoryPath}?${routeQuery}`
    : canonicalCategoryPath;

  const getSubCategoryHref = (sub: SubCategory) => {
    const subSlug = slugifyTR(sub.nameLower || sub.name || "");
    const base = `${canonicalCategoryPath}/${encodeURIComponent(subSlug)}`;
    return routeQuery ? `${base}?${routeQuery}` : base;
  };

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
                <Link
                  href={categoryHref}
                  className="shrink-0 rounded-2xl border px-4 py-4 text-left transition w-[calc((100%-16px)/2)] sm:w-[calc((100%-48px)/4)] bg-emerald-50 text-emerald-700 font-semibold border-emerald-200"
                >
                  <div className="text-xs uppercase tracking-wide text-[color:var(--market-muted)]">
                    Tümü
                  </div>
                  <div className="mt-1 text-base font-semibold">
                    {category.name}
                  </div>
                </Link>

                {subCategories.map((m) => (
                  <Link
                    key={m.id}
                    href={getSubCategoryHref(m)}
                    className="shrink-0 rounded-2xl border px-4 py-4 text-left transition w-[calc((100%-16px)/2)] sm:w-[calc((100%-48px)/4)] bg-white hover:bg-slate-50 border-slate-200"
                  >
                    <div className="text-xs uppercase tracking-wide text-[color:var(--market-muted)]">
                      Alt kategori
                    </div>
                    <div className="mt-1 text-sm font-semibold line-clamp-2">
                      {m.name}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ================= TOOLBAR (INLINE FILTERS) ================= */}
        {/* ================= TOOLBAR (INLINE FILTERS) ================= */}
        <div className="rounded-2xl border border-slate-200/70 bg-white/90 shadow-sm p-4 sm:p-5 backdrop-blur">
          <div className="grid grid-cols-[1fr_auto] gap-2 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar lg:justify-self-start">
              <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-xs text-slate-600 shrink-0">
                <span>Gösteriliyor</span>
                <span className="font-semibold text-slate-900">
                  {Math.min(visibleListings.length, sortedListings.length)}
                </span>
                <span className="text-slate-400">/</span>
                <span>{sortedListings.length}</span>
              </div>

              {appliedFiltersCount > 0 && (
                <div className="hidden sm:inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-xs text-emerald-700 shrink-0">
                  Filtre: <span className="font-semibold">{appliedFiltersCount}</span>
                </div>
              )}
            </div>

            <div className="hidden lg:flex items-center justify-center gap-2">
              {filterVisibility.showTradable && (
                <button
                  type="button"
                  onClick={() => applyPreset("tradableYes")}
                  className={`inline-flex items-center rounded-full border px-3 py-2 text-xs font-semibold transition ${
                    tradableFilter === "yes"
                      ? "border-emerald-700 bg-emerald-700 text-white"
                      : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                  }`}
                >
                  Takasa açık
                </button>
              )}
              {filterVisibility.showShipping && (
                <button
                  type="button"
                  onClick={() => applyPreset("shippingYes")}
                  className={`inline-flex items-center rounded-full border px-3 py-2 text-xs font-semibold transition ${
                    shippingFilter === "yes"
                      ? "border-sky-700 bg-sky-700 text-white"
                      : "border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100"
                  }`}
                >
                  Kargoya uygun
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 lg:justify-self-end">
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

              {category?.id && hasMore && (
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => fetchMore(category.id)}
                  className={`hidden md:inline-flex rounded-full border border-slate-200 bg-white px-3 py-2 text-xs shrink-0 ${loadingMore ? "opacity-60 cursor-not-allowed" : "hover:bg-slate-50"}`}
                >
                  {loadingMore ? "Yükleniyor..." : "Daha fazla ilan yükle"}
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

          {(filterVisibility.showTradable || filterVisibility.showShipping) && (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2 lg:hidden">
              {filterVisibility.showTradable && (
                <button
                  type="button"
                  onClick={() => applyPreset("tradableYes")}
                  className={`inline-flex items-center rounded-full border px-3 py-2 text-xs font-semibold transition ${
                    tradableFilter === "yes"
                      ? "border-emerald-700 bg-emerald-700 text-white"
                      : "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                  }`}
                >
                  Takasa açık
                </button>
              )}
              {filterVisibility.showShipping && (
                <button
                  type="button"
                  onClick={() => applyPreset("shippingYes")}
                  className={`inline-flex items-center rounded-full border px-3 py-2 text-xs font-semibold transition ${
                    shippingFilter === "yes"
                      ? "border-sky-700 bg-sky-700 text-white"
                      : "border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100"
                  }`}
                >
                  Kargoya uygun
                </button>
              )}
            </div>
          )}

          {activeFilterChips.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {activeFilterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => clearFilterByKey(chip.key)}
                  className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800 hover:bg-emerald-100"
                >
                  <span>{chip.label}</span>
                  <span className="font-semibold">×</span>
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 hidden md:flex md:flex-nowrap md:items-center md:gap-2 md:overflow-x-auto md:pb-1">
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm min-w-[220px]"
              placeholder="Ara..."
            />
            <input
              value={minPrice}
              onChange={(e) => setMinPrice(cleanDigits(e.target.value))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm w-28"
              placeholder="Min TL"
              inputMode="numeric"
            />
            <input
              value={maxPrice}
              onChange={(e) => setMaxPrice(cleanDigits(e.target.value))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm w-28"
              placeholder="Max TL"
              inputMode="numeric"
            />
            {filterVisibility.showCondition && (
              <select
                value={conditionFilter}
                onChange={(e) => setConditionFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm min-w-[180px]"
              >
                <option value="">Durum</option>
                {CONDITION_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
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
              className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 whitespace-nowrap"
            >
              Sıfırla
            </button>
          </div>

          {filtersOpen && (
            <div className="mt-3 grid grid-cols-1 gap-2 md:hidden">
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                placeholder="Ara..."
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={minPrice}
                  onChange={(e) => setMinPrice(cleanDigits(e.target.value))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="Min TL"
                  inputMode="numeric"
                />
                <input
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(cleanDigits(e.target.value))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="Max TL"
                  inputMode="numeric"
                />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {filterVisibility.showCondition && (
                  <select
                    value={conditionFilter}
                    onChange={(e) => setConditionFilter(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Durum</option>
                    {CONDITION_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={sortMode}
                  onChange={(e) =>
                    setSortMode(e.target.value as "newest" | "priceAsc" | "priceDesc")
                  }
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="newest">En yeni</option>
                  <option value="priceAsc">Fiyat (artan)</option>
                  <option value="priceDesc">Fiyat (azalan)</option>
                </select>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                >
                  Sıfırla
                </button>
              </div>
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
              const conditionLabel = getConditionLabel(l);
              const region = formatRegion(l.locationCity, l.locationDistrict);

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

                      {region ? (
                        <div className="text-xs text-slate-500 truncate">
                          Konum: {region}
                        </div>
                      ) : null}

                      <div className="text-[11px] text-slate-600 flex flex-wrap gap-2">
                        {conditionLabel ? (
                          <span className="px-2 py-1 rounded-full bg-slate-100">
                            {compactLabel(conditionLabel)}
                          </span>
                        ) : null}
                        {l.isTradable === true ? (
                          <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">
                            Takasa açık
                          </span>
                        ) : l.isTradable === false ? (
                          <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700">
                            Takas yok
                          </span>
                        ) : null}
                        {getShippingValue(l) === true ? (
                          <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700">
                            Kargo uygun
                          </span>
                        ) : getShippingValue(l) === false ? (
                          <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700">
                            Kargo uygun değil
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
                const conditionLabel = getConditionLabel(l);
                const region = formatRegion(l.locationCity, l.locationDistrict);

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

                        {region ? (
                          <div className="text-xs text-slate-500 truncate">
                            Konum: {region}
                          </div>
                        ) : null}

                        <div className="text-[11px] text-slate-600 flex flex-wrap gap-2">
                        {conditionLabel ? (
                          <span className="px-2 py-1 rounded-full bg-slate-100">
                            {compactLabel(conditionLabel)}
                          </span>
                        ) : null}
                        {l.isTradable === true ? (
                          <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">
                            Takasa açık
                          </span>
                        ) : l.isTradable === false ? (
                          <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700">
                            Takas yok
                          </span>
                        ) : null}
                        {getShippingValue(l) === true ? (
                          <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700">
                            Kargo uygun
                          </span>
                        ) : getShippingValue(l) === false ? (
                          <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700">
                            Kargo uygun değil
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
