"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useParams,
  useRouter,
  usePathname,
  useSearchParams,
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
  categoryId: string;
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

  description?: string;

  createdAt?: any;
  imageUrls?: string[];

  ownerId?: string;
};

type SubCategoryClientProps = {
  initialCategory?: Category | null;
  initialSubCategory?: SubCategory | null;
  initialSubCategories?: SubCategory[];
  initialListings?: Listing[];
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

const toMillis = (v: any) => {
  const d: Date =
    v?.toDate?.() instanceof Date
      ? v.toDate()
      : v instanceof Date
      ? v
      : null;
  return d ? d.getTime() : 0;
};

const compactLabel = (s?: string) => {
  const t = normalizeSpaces(s || "");
  return t.length > 18 ? t.slice(0, 18) + "..." : t;
};

const clampInt = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.trunc(n)));

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

/* ================= URL HELPERS (✅ pickEnum fix) ================= */

function pickEnum<T extends string>(
  raw: string | null | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  if (!raw) return fallback;
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

function pickPageSize(raw: string | null | undefined, fallback: 24 | 48 | 96) {
  const n = Number(raw);
  if (n === 24 || n === 48 || n === 96) return n;
  return fallback;
}

function cleanParam(v: string) {
  return normalizeSpaces(v || "");
}

/* ================= CONSTS ================= */

const SORT_OPTIONS = ["newest", "priceAsc", "priceDesc"] as const;
const VIEW_OPTIONS = ["grid", "list"] as const;

/* ================= PAGE ================= */

export default function SubCategoryClient({
  initialCategory = null,
  initialSubCategory = null,
  initialSubCategories = [],
  initialListings = [],
  initialHasMore = false,
}: SubCategoryClientProps) {
  const params = useParams<{ category: string; subCategory: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const categorySlug = params?.category
    ? decodeURIComponent(params.category)
    : "";
  const subCategorySlug = params?.subCategory
    ? decodeURIComponent(params.subCategory)
    : "";
  const visibleInitialListings = initialListings.filter((item) =>
    isPublicListingVisible(item)
  );

  const [category, setCategory] = useState<Category | null>(initialCategory);
  const [subCategory, setSubCategory] = useState<SubCategory | null>(
    initialSubCategory
  );
  const [subCategories, setSubCategories] = useState<SubCategory[]>(
    initialSubCategories
  );

  // ✅ Firestore pagination listings
  const [listings, setListings] = useState<Listing[]>(visibleInitialListings);
  const [lastDoc, setLastDoc] =
    useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(initialHasMore);

  const [loading, setLoading] = useState(!initialCategory); // initial
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ================= UI STATES ================= */

  const [viewMode, setViewMode] = useState<(typeof VIEW_OPTIONS)[number]>("grid");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [sortMode, setSortMode] = useState<(typeof SORT_OPTIONS)[number]>("newest");

  // fetch size per page
  const [pageSize, setPageSize] = useState<24 | 48 | 96>(24);
  const subScrollRef = useRef<HTMLDivElement | null>(null);

  /* ================= FILTER STATES ================= */

  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [conditionFilter, setConditionFilter] = useState("");
  const [tradableFilter, setTradableFilter] = useState<"" | "yes" | "no">("");
  const [shippingFilter, setShippingFilter] = useState<"" | "yes" | "no">("");

  const [searchText, setSearchText] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      setSearchDebounced(searchText);
    }, 250);
    return () => clearTimeout(t);
  }, [searchText]);

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
      chips.push({ key: "price", label: `Fiyat: ${minP || "0"} - ${maxP || "sonsuz"}` });
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
  }, [searchText, minPrice, maxPrice, conditionFilter, tradableFilter, shippingFilter]);

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

  const filterVisibility = useMemo(() => {
    const hasCondition = listings.some((l) => !!getConditionKey(l));
    const hasTradable = true;
    const hasShipping = true;

    return {
      showCondition: hasCondition,
      showTradable: hasTradable,
      showShipping: hasShipping,
    };
  }, [listings]);

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

  /* ================= URL INIT (? URL'den filtre oku) ================= */

  const urlHydratingRef = useRef(false);
  const urlReadyRef = useRef(false);

  useEffect(() => {
    if (!categorySlug || !subCategorySlug) return;

    urlHydratingRef.current = true;
    urlReadyRef.current = false;

    const sp = new URLSearchParams(searchParams?.toString() || "");

    setSortMode(pickEnum(sp.get("sort"), SORT_OPTIONS, "newest"));
    setViewMode(pickEnum(sp.get("view"), VIEW_OPTIONS, "grid"));
    setPageSize(pickPageSize(sp.get("ps"), 24));

    setMinPrice(cleanParam(sp.get("minPrice") || "").replace(/[^\d]/g, ""));
    setMaxPrice(cleanParam(sp.get("maxPrice") || "").replace(/[^\d]/g, ""));

    setSearchText(cleanParam(sp.get("q") || ""));
    setConditionFilter(
      pickEnum(
        sp.get("condition"),
        CONDITION_OPTIONS.map((item) => item.value),
        ""
      )
    );
    setTradableFilter(pickEnum(sp.get("tradable"), ["", "yes", "no"] as const, ""));
    setShippingFilter(pickEnum(sp.get("shipping"), ["", "yes", "no"] as const, ""));

    setTimeout(() => {
      urlHydratingRef.current = false;
      urlReadyRef.current = true;
    }, 0);
  }, [categorySlug, subCategorySlug, searchParams]);

  /* ================= URL SYNC (filtreler değişince URL yaz) ================= */

  useEffect(() => {
    if (!pathname) return;
    if (!urlReadyRef.current) return;
    if (urlHydratingRef.current) return;

    const sp = new URLSearchParams();

    if (sortMode !== "newest") sp.set("sort", sortMode);
    if (viewMode !== "grid") sp.set("view", viewMode);
    if (pageSize !== 24) sp.set("ps", String(pageSize));

    if (searchText.trim()) sp.set("q", searchText.trim());
    if (minPrice.trim()) sp.set("minPrice", minPrice.trim());
    if (maxPrice.trim()) sp.set("maxPrice", maxPrice.trim());
    if (conditionFilter) sp.set("condition", conditionFilter);
    if (tradableFilter) sp.set("tradable", tradableFilter);
    if (shippingFilter) sp.set("shipping", shippingFilter);

    const nextQs = sp.toString();
    const curQs = searchParams?.toString() || "";

    if (nextQs === curQs) return;

    const nextUrl = nextQs ? `${pathname}?${nextQs}` : pathname;
    router.replace(nextUrl, { scroll: false });
  }, [
    pathname,
    router,
    searchParams,
    sortMode,
    viewMode,
    pageSize,
    searchText,
    minPrice,
    maxPrice,
    conditionFilter,
    tradableFilter,
    shippingFilter,
  ]);

  /* ================= LOAD CATEGORY + SUBCATEGORY ================= */

  useEffect(() => {
    if (!categorySlug || !subCategorySlug) return;
    if (initialCategory && initialSubCategory) return;

    let cancelled = false;

    async function loadCategorySubCategory() {
      if (!initialCategory) setLoading(true);
      setError(null);

      try {
        // CATEGORY
        const categoryDocs = (await getCategoriesCached()).map((d: any) => ({
          id: d.id,
          ...(d as any),
        }));
        const categoryKey = normTRAscii(categorySlug);
        const categorySlugKey = slugifyTR(categorySlug);
        const matchCategory = categoryDocs.find((c) => {
          const keys = [
            c.id,
            c.slug,
            c.nameLower,
            c.name,
          ].map((x) => normTRAscii(x));
          const slugs = [c.slug, c.nameLower, c.name].map((x) =>
            slugifyTR(String(x || ""))
          );
          return keys.includes(categoryKey) || slugs.includes(categorySlugKey);
        });
        if (!matchCategory) throw new Error("Kategori bulunamadi.");

        const canonicalCategorySlug = slugifyTR(
          matchCategory.slug || matchCategory.nameLower || matchCategory.name || ""
        );

        const b: Category = {
          id: matchCategory.id,
          name: matchCategory.name,
          nameLower: matchCategory.nameLower,
        };

        if (cancelled) return;
        setCategory(b);

        // SUBCATEGORY (categories parentId)
        const subDocs = categoryDocs.filter((d) => d.parentId === b.id);
        const subList = subDocs
          .map((d) => ({
            id: d.id,
            name: d.name,
            nameLower: d.nameLower,
            categoryId: d.parentId,
          }))
          .sort((a, b) =>
            (a.nameLower || a.name).localeCompare(b.nameLower || b.name, "tr")
          ) as SubCategory[];
        const subKey = normTRAscii(subCategorySlug);
        const subSlugKey = slugifyTR(subCategorySlug);
        const matchSub = subDocs.find((s) => {
          const keys = [
            s.id,
            s.slug,
            s.nameLower,
            s.name,
          ].map((x) => normTRAscii(x));
          const slugs = [s.slug, s.nameLower, s.name].map((x) =>
            slugifyTR(String(x || ""))
          );
          return keys.includes(subKey) || slugs.includes(subSlugKey);
        });
        if (!matchSub) throw new Error("Alt kategori bulunamadi.");

        const canonicalSubSlug = slugifyTR(
          matchSub.slug || matchSub.nameLower || matchSub.name || ""
        );
        if (
          canonicalCategorySlug &&
          canonicalSubSlug &&
          ((categorySlug || "").trim() !== canonicalCategorySlug ||
            (subCategorySlug || "").trim() !== canonicalSubSlug)
        ) {
          const qs = searchParams?.toString();
          const canonicalPath = `/${encodeURIComponent(
            canonicalCategorySlug
          )}/${encodeURIComponent(canonicalSubSlug)}`;
          router.replace(qs ? `${canonicalPath}?${qs}` : canonicalPath);
        }

        const m: SubCategory = {
          id: matchSub.id,
          name: matchSub.name,
          nameLower: matchSub.nameLower,
          categoryId: matchSub.parentId,
        };

        if (cancelled) return;
        setSubCategories(subList);
        setSubCategory(m);
      } catch (e: any) {
        devError("SubCategory page load error", e);
        if (!cancelled) {
          setError(getFriendlyErrorMessage(e, "Bir hata oluştu."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadCategorySubCategory();

    return () => {
      cancelled = true;
    };
  }, [categorySlug, subCategorySlug]);

  /* ================= FIRESTORE PAGINATION (✅ 2000 ilan uçurur) ================= */

  const serverQueryKey = useMemo(() => {
    const priceKey =
      sortMode === "priceAsc" || sortMode === "priceDesc"
        ? `${minPrice || ""}-${maxPrice || ""}`
        : "";

    return [
      subCategory?.id || "",
      sortMode,
      String(pageSize),
      conditionFilter,
      tradableFilter,
      shippingFilter,
      priceKey,
    ].join("|");
  }, [
    subCategory?.id,
    sortMode,
    pageSize,
    conditionFilter,
    tradableFilter,
    shippingFilter,
    minPrice,
    maxPrice,
  ]);

  const isIndexError = (e: any) => {
    const msg = String(e?.message || "");
    return msg.includes("requires an index");
  };

  const fetchSubCategoryBatch = async (
    subCategoryId: string,
    startAfterDoc: QueryDocumentSnapshot<DocumentData> | null
  ) => {
    try {
      const constraints: any[] = [
        where("subCategoryId", "==", subCategoryId),
        where("status", "==", "active"),
        orderBy("createdAt", "desc"),
        limit(pageSize),
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
        hasMore: docs.length === pageSize,
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
          where("subCategoryId", "==", subCategoryId),
          where("status", "==", "active"),
          limit(pageSize)
        )
      );
      const docs = snap.docs;
      const collected = docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((item) => isPublicListingVisible(item as Listing)) as Listing[];

      collected.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

      return {
        items: collected,
        lastDoc: docs.length > 0 ? docs[docs.length - 1] : startAfterDoc,
        hasMore: false,
      };
    }
  };

  const fetchPage = async (reset: boolean) => {
    if (!subCategory?.id) return;
    if (reset) {
      if (reset && initialListings.length === 0) setLoading(true);
      setHasMore(true);
      setLastDoc(null);
      setListings([]);
    } else {
      if (loadingMore) return;
      setLoadingMore(true);
    }

    try {
      const batch = await fetchSubCategoryBatch(
        subCategory.id,
        reset ? null : lastDoc
      );

      setLastDoc(batch.lastDoc);
      setHasMore(batch.hasMore);

      if (reset) {
        setListings(batch.items);
      } else {
        // append'te dedupe (duplicate key fix)
        setListings((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          const merged = [...prev];
          for (const it of batch.items) {
            if (!seen.has(it.id)) {
              merged.push(it);
              seen.add(it.id);
            }
          }
          return merged;
        });
      }
    } catch (e: any) {
      devError("SubCategory fetch error", e);
      setError(getFriendlyErrorMessage(e, "Liste yuklenemedi."));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // query degisince reset + ilk sayfa cek
  useEffect(() => {
    if (!subCategory?.id) return;
    if (!urlReadyRef.current) return;
    if (urlHydratingRef.current) return;

    fetchPage(true);
  }, [serverQueryKey, subCategory?.id]);

  /* ================= CLIENT FILTER (year vb.) ================= */

  const filteredListings = useMemo(() => {
    const minP = toNumOrNull(minPrice);
    const maxP = toNumOrNull(maxPrice);
    const q = normTR(searchDebounced);

    let next = listings.filter((l) => {
      if (q) {
        const hay = `${l.title || ""} ${l.subCategoryName || ""} ${l.categoryName || ""}`
          .toLocaleLowerCase("tr-TR")
          .trim();
        if (!hay.includes(q)) return false;
      }

      if (conditionFilter && getConditionKey(l) !== conditionFilter) return false;

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

      if (minP !== null) {
        const p = Number(l.price);
        if (!Number.isFinite(p) || p < minP) return false;
      }
      if (maxP !== null) {
        const p = Number(l.price);
        if (!Number.isFinite(p) || p > maxP) return false;
      }

      return true;
    });

    if (sortMode === "priceAsc") {
      next = [...next].sort((a, b) => {
        const ap = Number(a.price);
        const bp = Number(b.price);
        if (Number.isFinite(ap) && Number.isFinite(bp) && ap !== bp) {
          return ap - bp;
        }
        return toMillis(b.createdAt) - toMillis(a.createdAt);
      });
    } else if (sortMode === "priceDesc") {
      next = [...next].sort((a, b) => {
        const ap = Number(a.price);
        const bp = Number(b.price);
        if (Number.isFinite(ap) && Number.isFinite(bp) && ap !== bp) {
          return bp - ap;
        }
        return toMillis(b.createdAt) - toMillis(a.createdAt);
      });
    } else {
      next = [...next].sort(
        (a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)
      );
    }

    return next;
  }, [
    listings,
    minPrice,
    maxPrice,
    conditionFilter,
    tradableFilter,
    shippingFilter,
    sortMode,
    searchDebounced,
  ]);

  /* ================= UI STATES ================= */

  if (loading && !category && !subCategory) {
    return (
      <div className="min-h-screen bg-[#f7f4ef] px-4 py-10">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="bg-white/90 rounded-3xl border border-slate-200/70 shadow-sm p-8 animate-pulse">
            <div className="h-6 w-60 bg-slate-200 rounded mb-3" />
            <div className="h-4 w-96 bg-slate-200 rounded" />
          </div>

          <div className="bg-white/90 rounded-3xl border border-slate-200/70 shadow-sm p-6 animate-pulse">
            <div className="h-5 w-40 bg-slate-200 rounded mb-4" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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

  if (!category || !subCategory) return null;

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
      <div className={`${sora.className} relative z-10 mx-auto max-w-7xl px-4 py-8 sm:py-12 space-y-8`}>
        {/* ================= BREADCRUMB ================= */}
        <div className="flex flex-wrap items-center gap-2 text-base sm:text-lg font-semibold text-[color:var(--market-ink)]">
          <Link href="/" className="hover:opacity-80 transition">
            Ana sayfa
          </Link>
          <span className="opacity-40">/</span>
          <Link
            href={`/${slugifyTR(category.nameLower || category.name)}`}
            className="hover:opacity-80 transition"
          >
            {category.name}
          </Link>
          <span className="opacity-40">/</span>
          <span>
            {subCategory.name}{" "}
            <span className="text-[color:var(--market-muted)] font-normal">
              ({listings.length})
            </span>
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
                  href={`/${slugifyTR(category.nameLower || category.name)}`}
                  className="shrink-0 rounded-2xl border px-4 py-4 text-left transition w-[calc((100%-16px)/2)] sm:w-[calc((100%-48px)/4)] bg-white hover:bg-slate-50 border-slate-200"
                >
                  <div className="text-xs uppercase tracking-wide text-[color:var(--market-muted)]">
                    Tümü
                  </div>
                  <div className="mt-1 text-sm font-semibold">
                    {category.name}
                  </div>
                </Link>

                {subCategories.map((m) => (
                  <Link
                    key={m.id}
                    href={`/${slugifyTR(category.nameLower || category.name)}/${slugifyTR(m.nameLower || m.name)}`}
                    className={`shrink-0 rounded-2xl border px-4 py-4 text-left transition w-[calc((100%-16px)/2)] sm:w-[calc((100%-48px)/4)] ${
                      subCategory.id === m.id
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
                <span className="font-semibold text-slate-900">{filteredListings.length}</span>
                {hasMore ? <span className="hidden sm:inline text-slate-400">(daha fazlası var)</span> : null}
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
              onChange={(e) => setMinPrice(e.target.value.replace(/[^\d]/g, ""))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm w-28"
              placeholder="Min TL"
              inputMode="numeric"
            />
            <input
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value.replace(/[^\d]/g, ""))}
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
                setSortMode(pickEnum(e.target.value, SORT_OPTIONS, "newest"))
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
                  onChange={(e) => setMinPrice(e.target.value.replace(/[^\d]/g, ""))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  placeholder="Min TL"
                  inputMode="numeric"
                />
                <input
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value.replace(/[^\d]/g, ""))}
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
                  onChange={(e) => setSortMode(pickEnum(e.target.value, SORT_OPTIONS, "newest"))}
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
        {filteredListings.length === 0 ? (
          <div className="rounded-3xl border border-slate-200/70 bg-white/90 p-8 text-center shadow-sm text-[color:var(--market-muted)]">
            Bu filtrelere uygun ilan bulunamadı.
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredListings.map((l) => {
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
                          {category.name} / {l.subCategoryName || subCategory.name}
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
              {filteredListings.map((l) => {
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
                            {category.name} / {subCategory.name}
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

        {/* ================= LOAD MORE ================= */}
        {hasMore && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => fetchPage(false)}
              disabled={loadingMore}
              className={`px-6 py-3 rounded-xl font-semibold text-white shadow-sm ${
                loadingMore ? "bg-gray-400 cursor-not-allowed" : "bg-slate-900 hover:bg-black"
              }`}
            >
              {loadingMore ? "Yükleniyor..." : "Daha fazla göster"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
