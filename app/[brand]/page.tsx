"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useParams,
  useRouter,
  useSearchParams,
  usePathname,
} from "next/navigation";
import Link from "next/link";
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

/* ================= TYPES ================= */

type Brand = {
  id: string;
  name: string;
  nameLower: string;
};

type Model = {
  id: string;
  name: string;
  nameLower: string;
  brandId?: string;
};

type Listing = {
  id: string;
  title?: string;
  price?: number;

  brandId?: string;
  brandName?: string;

  modelId?: string;
  modelName?: string;

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

/* ================= HELPERS ================= */

const normalizeSpaces = (v: string) => (v || "").replace(/\s+/g, " ").trim();

const safeText = (v?: string, fallback = "—") => {
  const t = normalizeSpaces(v || "");
  return t ? t : fallback;
};

const normTR = (v?: string) =>
  normalizeSpaces(v || "").toLocaleLowerCase("tr-TR");

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

/* ================= PAGE ================= */

export default function BrandPage() {
  const params = useParams<{ brand: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const brandSlug = params?.brand;

  /* ================= DATA ================= */

  const [brand, setBrand] = useState<Brand | null>(null);
  const [models, setModels] = useState<Model[]>([]);

  // ✅ Pagination ile yüklenen ham ilanlar
  const [listingsRaw, setListingsRaw] = useState<Listing[]>([]);
  const [cursor, setCursor] =
    useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // optional: total count
  const [totalCount, setTotalCount] = useState<number | null>(null);

  /* ================= UI STATES ================= */

  const [filterOpen, setFilterOpen] = useState(false);

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

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

  const [modelId, setModelId] = useState("");

  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  const [yearMin, setYearMin] = useState("");
  const [yearMax, setYearMax] = useState("");

  const [gender, setGender] = useState("");
  const [movementType, setMovementType] = useState("");
  const [caseType, setCaseType] = useState("");
  const [braceletMaterial, setBraceletMaterial] = useState("");

  const [diaMin, setDiaMin] = useState("");
  const [diaMax, setDiaMax] = useState("");

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

  const movementOptions = useMemo(
    () => ["Otomatik", "Quartz", "Manual", "Diğer"],
    []
  );

  const caseTypeOptions = useMemo(
    () => [
      "Çelik",
      "Titanyum",
      "Altın",
      "Seramik",
      "Karbon",
      "Bronz",
      "Gümüş",
      "Platin",
      "Diğer",
    ],
    []
  );

  const braceletMaterialOptions = useMemo(
    () => [
      "Çelik",
      "Deri",
      "Kauçuk",
      "NATO",
      "Titanyum",
      "Tekstil",
      "Seramik",
      "Diğer",
    ],
    []
  );

  const diameterOptions = useMemo(() => {
    return [
      "28",
      "30",
      "32",
      "34",
      "35",
      "36",
      "37",
      "38",
      "39",
      "40",
      "41",
      "42",
      "43",
      "44",
      "45",
      "46",
      "48",
    ];
  }, []);

  /* ================= URL SYNC (INIT) ================= */

  const didInitFromUrl = useRef(false);
  const lastReplacedUrl = useRef<string>("");

  // Brand slug değişince URL init’i tekrar izin ver
  useEffect(() => {
    didInitFromUrl.current = false;
  }, [brandSlug]);

  useEffect(() => {
    if (!brandSlug) return;
    if (didInitFromUrl.current) return;

    // ✅ URL’den filtreleri state’e bas
    const q = searchParams.get("q") || "";
    const model = searchParams.get("modelId") || "";
    const minP = searchParams.get("minPrice") || "";
    const maxP = searchParams.get("maxPrice") || "";
    const yMin = searchParams.get("yearMin") || "";
    const yMax = searchParams.get("yearMax") || "";
    const g = searchParams.get("gender") || "";
    const mv = searchParams.get("movementType") || "";
    const ct = searchParams.get("caseType") || "";
    const bm = searchParams.get("braceletMaterial") || "";
    const dMin = searchParams.get("diaMin") || "";
    const dMax = searchParams.get("diaMax") || "";
    const wear = (searchParams.get("wear") || "") as "" | "wear" | "noWear";

    const sort = (searchParams.get("sort") || "newest") as
      | "newest"
      | "priceAsc"
      | "priceDesc";

    const view = (searchParams.get("view") || "grid") as "grid" | "list";

    setSearchText(q);
    setModelId(model);

    setMinPrice(cleanDigits(minP));
    setMaxPrice(cleanDigits(maxP));

    setYearMin(cleanDigits(yMin));
    setYearMax(cleanDigits(yMax));

    setGender(pickEnum(g, genderOptions));
    setMovementType(pickEnum(mv, movementOptions));
    setCaseType(pickEnum(ct, caseTypeOptions));
    setBraceletMaterial(pickEnum(bm, braceletMaterialOptions));

    setDiaMin(cleanDigits(dMin));
    setDiaMax(cleanDigits(dMax));

    setWearFilter(wear === "wear" || wear === "noWear" ? wear : "");

    setSortMode(sort);
    setViewMode(view);

    // UX: linkten gelince "her şey gelsin" diye 24 bırakıyoruz (istersen 48 yap)
    setPageSize(24);

    didInitFromUrl.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    brandSlug,
    searchParams,
    genderOptions,
    movementOptions,
    caseTypeOptions,
    braceletMaterialOptions,
  ]);

  /* ================= URL SYNC (STATE → URL) ================= */

  useEffect(() => {
    if (!didInitFromUrl.current) return;
    if (!pathname) return;

    const sp = new URLSearchParams();

    if (searchText.trim()) sp.set("q", searchText.trim());
    if (modelId) sp.set("modelId", modelId);

    if (minPrice.trim()) sp.set("minPrice", minPrice.trim());
    if (maxPrice.trim()) sp.set("maxPrice", maxPrice.trim());

    if (yearMin.trim()) sp.set("yearMin", yearMin.trim());
    if (yearMax.trim()) sp.set("yearMax", yearMax.trim());

    if (gender.trim()) sp.set("gender", gender.trim());
    if (movementType.trim()) sp.set("movementType", movementType.trim());
    if (caseType.trim()) sp.set("caseType", caseType.trim());
    if (braceletMaterial.trim()) sp.set("braceletMaterial", braceletMaterial.trim());

    if (diaMin.trim()) sp.set("diaMin", diaMin.trim());
    if (diaMax.trim()) sp.set("diaMax", diaMax.trim());

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
    modelId,
    minPrice,
    maxPrice,
    yearMin,
    yearMax,
    gender,
    movementType,
    caseType,
    braceletMaterial,
    diaMin,
    diaMax,
    wearFilter,
    sortMode,
    viewMode,
  ]);

  /* ================= FILTER UTIL ================= */

  const clearFilters = () => {
    setModelId("");
    setMinPrice("");
    setMaxPrice("");
    setYearMin("");
    setYearMax("");
    setGender("");
    setMovementType("");
    setCaseType("");
    setBraceletMaterial("");
    setDiaMin("");
    setDiaMax("");
    setWearFilter("");
    setSearchText("");
    setSortMode("newest");
    setViewMode("grid");
    setPageSize(24);
  };

  const appliedFiltersCount = useMemo(() => {
    let c = 0;
    if (modelId.trim()) c++;
    if (minPrice.trim()) c++;
    if (maxPrice.trim()) c++;
    if (yearMin.trim()) c++;
    if (yearMax.trim()) c++;
    if (gender.trim()) c++;
    if (movementType.trim()) c++;
    if (caseType.trim()) c++;
    if (braceletMaterial.trim()) c++;
    if (diaMin.trim()) c++;
    if (diaMax.trim()) c++;
    if (wearFilter) c++;
    if (searchText.trim()) c++;
    if (sortMode !== "newest") c++;
    if (viewMode !== "grid") c++;
    return c;
  }, [
    modelId,
    minPrice,
    maxPrice,
    yearMin,
    yearMax,
    gender,
    movementType,
    caseType,
    braceletMaterial,
    diaMin,
    diaMax,
    wearFilter,
    searchText,
    sortMode,
    viewMode,
  ]);

  /* ================= LOAD BRAND + MODELS + LISTINGS (PAGINATION) ================= */

  const LISTINGS_BATCH = 60;

  const fetchFirstPage = async (brandId: string) => {
    const q = query(
      collection(db, "listings"),
      where("brandId", "==", brandId),
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

  const fetchMore = async (brandId: string) => {
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
        where("brandId", "==", brandId),
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
      console.error("fetchMore error:", e);
      // hasMore false yapmıyoruz; kullanıcı tekrar deneyebilir
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!brandSlug) return;

    let cancelled = false;

    async function loadAll() {
      setLoading(true);
      setError(null);

      try {
        // reset pagination state
        setListingsRaw([]);
        setCursor(null);
        setHasMore(true);
        setTotalCount(null);

        // 1) BRAND
        const brandSnap = await getDocs(
          query(collection(db, "brands"), where("nameLower", "==", brandSlug))
        );

        if (brandSnap.empty) throw new Error("Marka bulunamadı.");

        const bDoc = brandSnap.docs[0];
        const b: Brand = {
          id: bDoc.id,
          name: bDoc.data().name,
          nameLower: bDoc.data().nameLower,
        };

        if (cancelled) return;
        setBrand(b);

        // 2) MODELS
        const modelsSnap = await getDocs(
          query(
            collection(db, "models"),
            where("brandId", "==", b.id),
            orderBy("nameLower", "asc")
          )
        );

        if (cancelled) return;

        const ms = modelsSnap.docs.map((d) => ({
          id: d.id,
          name: d.data().name,
          nameLower: d.data().nameLower,
          brandId: d.data().brandId,
        })) as Model[];

        setModels(Array.isArray(ms) ? ms : []);

        // 3) LISTINGS FIRST PAGE (pagination)
        await fetchFirstPage(b.id);

        // 4) OPTIONAL COUNT (sessiz fail)
        try {
          const countSnap = await getCountFromServer(
            query(collection(db, "listings"), where("brandId", "==", b.id))
          );
          if (!cancelled) setTotalCount(countSnap.data().count);
        } catch (e) {
          // rules / izin yoksa count çalışmayabilir
        }
      } catch (e: any) {
        console.error(e);
        if (!cancelled) setError(e?.message || "Bir hata oluştu.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAll();

    return () => {
      cancelled = true;
    };
  }, [brandSlug]);

  /* ================= MODEL COUNTS (popülerlik) ================= */

  const modelCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    listingsRaw.forEach((l) => {
      if (!l.modelId) return;
      acc[l.modelId] = (acc[l.modelId] || 0) + 1;
    });
    return acc;
  }, [listingsRaw]);

  const popularModels = useMemo(() => {
    const arr = [...models];
    arr.sort((a, b) => {
      const ac = modelCounts[a.id] || 0;
      const bc = modelCounts[b.id] || 0;
      if (bc !== ac) return bc - ac;
      return (a.nameLower || a.name).localeCompare(b.nameLower || b.name, "tr");
    });
    return arr;
  }, [models, modelCounts]);

  /* ================= FILTER + SORT + LIMIT ================= */

  const filteredListings = useMemo(() => {
    const minP = toNumOrNull(minPrice);
    const maxP = toNumOrNull(maxPrice);

    const yMin = toIntOrNull(yearMin);
    const yMax = toIntOrNull(yearMax);

    const dMin = toNumOrNull(diaMin);
    const dMax = toNumOrNull(diaMax);

    const g = normTR(gender);
    const mv = normTR(movementType);
    const ct = normTR(caseType);
    const bm = normTR(braceletMaterial);

    const q = normTR(searchDebounced);

    return listingsRaw.filter((l) => {
      // model
      if (modelId) {
        if ((l.modelId || "") !== modelId) return false;
      }

      // search
      if (q) {
        const hay = `${l.title || ""} ${l.modelName || ""} ${l.brandName || ""}`
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

      // movement
      if (mv) {
        const lm = normTR(l.movementType || "");
        if (!lm) return false;
        if (lm !== mv) return false;
      }

      // case type
      if (ct) {
        const lc = normTR(l.caseType || "");
        if (!lc) return false;
        if (lc !== ct && !lc.includes(ct)) return false;
      }

      // bracelet material
      if (bm) {
        const lbm = normTR(l.braceletMaterial || "");
        if (!lbm) return false;
        if (lbm !== bm && !lbm.includes(bm)) return false;
      }

      // diameter
      const dia = getDiaNumber(l.diameterMm ?? null);
      if (dMin !== null) {
        if (dia === null || dia < dMin) return false;
      }
      if (dMax !== null) {
        if (dia === null || dia > dMax) return false;
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
    modelId,
    minPrice,
    maxPrice,
    yearMin,
    yearMax,
    gender,
    movementType,
    caseType,
    braceletMaterial,
    diaMin,
    diaMax,
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
    if (!brand?.id) return;
    if (!hasMore) return;
    if (loadingMore) return;

    // pageSize > listingsRaw.length ise Firestore’dan yeni sayfa çek
    if (pageSize > listingsRaw.length) {
      fetchMore(brand.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize, listingsRaw.length, brand?.id, hasMore, loadingMore]);

  /* ================= PRESETS (Hızlı Filtreler) ================= */

  const applyPreset = (p: string) => {
    if (p === "auto") {
      setMovementType("Otomatik");
      setSortMode("newest");
      return;
    }
    if (p === "quartz") {
      setMovementType("Quartz");
      setSortMode("newest");
      return;
    }
    if (p === "year2020") {
      setYearMin("2020");
      setYearMax("");
      setSortMode("newest");
      return;
    }
    if (p === "size3640") {
      setDiaMin("36");
      setDiaMax("40");
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

  /* ================= ACTIVE FILTER BADGES ================= */

  const selectedModel = modelId ? models.find((m) => m.id === modelId) : null;

  const activeBadges = useMemo(() => {
    const items: { key: string; label: string; onClear: () => void }[] = [];

    if (selectedModel) {
      items.push({
        key: "model",
        label: `Model: ${selectedModel.name}`,
        onClear: () => setModelId(""),
      });
    }

    if (searchText.trim()) {
      items.push({
        key: "search",
        label: `Arama: ${searchText.trim()}`,
        onClear: () => setSearchText(""),
      });
    }

    if (minPrice.trim()) {
      items.push({
        key: "minPrice",
        label: `Min: ${minPrice} TL`,
        onClear: () => setMinPrice(""),
      });
    }

    if (maxPrice.trim()) {
      items.push({
        key: "maxPrice",
        label: `Max: ${maxPrice} TL`,
        onClear: () => setMaxPrice(""),
      });
    }

    if (yearMin.trim()) {
      items.push({
        key: "yearMin",
        label: `Yıl ≥ ${yearMin}`,
        onClear: () => setYearMin(""),
      });
    }

    if (yearMax.trim()) {
      items.push({
        key: "yearMax",
        label: `Yıl ≤ ${yearMax}`,
        onClear: () => setYearMax(""),
      });
    }

    if (gender.trim()) {
      items.push({
        key: "gender",
        label: `Cinsiyet: ${gender}`,
        onClear: () => setGender(""),
      });
    }

    if (movementType.trim()) {
      items.push({
        key: "movement",
        label: `Çalışma: ${movementType}`,
        onClear: () => setMovementType(""),
      });
    }

    if (caseType.trim()) {
      items.push({
        key: "caseType",
        label: `Kasa: ${caseType}`,
        onClear: () => setCaseType(""),
      });
    }

    if (braceletMaterial.trim()) {
      items.push({
        key: "bracelet",
        label: `Kordon: ${braceletMaterial}`,
        onClear: () => setBraceletMaterial(""),
      });
    }

    if (diaMin.trim()) {
      items.push({
        key: "diaMin",
        label: `Çap ≥ ${diaMin}mm`,
        onClear: () => setDiaMin(""),
      });
    }

    if (diaMax.trim()) {
      items.push({
        key: "diaMax",
        label: `Çap ≤ ${diaMax}mm`,
        onClear: () => setDiaMax(""),
      });
    }

    if (wearFilter) {
      items.push({
        key: "wear",
        label: wearFilter === "wear" ? "Aşınma var" : "Aşınma yok",
        onClear: () => setWearFilter(""),
      });
    }

    if (sortMode !== "newest") {
      items.push({
        key: "sort",
        label:
          sortMode === "priceAsc"
            ? "Sıralama: Fiyat ↑"
            : "Sıralama: Fiyat ↓",
        onClear: () => setSortMode("newest"),
      });
    }

    if (viewMode !== "grid") {
      items.push({
        key: "view",
        label: "Görünüm: Liste",
        onClear: () => setViewMode("grid"),
      });
    }

    return items;
  }, [
    selectedModel,
    searchText,
    minPrice,
    maxPrice,
    yearMin,
    yearMax,
    gender,
    movementType,
    caseType,
    braceletMaterial,
    diaMin,
    diaMax,
    wearFilter,
    sortMode,
    viewMode,
  ]);

  /* ================= UI STATES ================= */

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 px-4 py-10">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="bg-white rounded-2xl shadow p-8">
            <div className="h-6 w-60 bg-gray-200 rounded mb-3" />
            <div className="h-4 w-96 bg-gray-200 rounded" />
          </div>

          <div className="bg-white rounded-2xl shadow p-6">
            <div className="h-5 w-40 bg-gray-200 rounded mb-4" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-64 bg-gray-200 rounded-2xl" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 px-4 py-10">
        <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow p-8 text-center">
          <div className="text-red-700 font-semibold mb-2">Hata</div>
          <div className="text-gray-700 mb-6">{error}</div>
          <button
            onClick={() => router.push("/")}
            className="underline text-blue-600"
          >
            Ana sayfaya dön
          </button>
        </div>
      </div>
    );
  }

  if (!brand) return null;

  const loadedCount = listingsRaw.length;
  const totalShow = totalCount === null ? `${loadedCount}` : `${totalCount}`;

  /* ================= UI ================= */

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-7xl mx-auto px-4 py-8 sm:py-10 space-y-6">
        {/* ================= BREADCRUMB ================= */}
        <div className="text-sm text-gray-600">
          <Link href="/" className="hover:underline">
            Ana sayfa
          </Link>
          <span className="mx-2">/</span>
          <span className="text-gray-900 font-medium">{brand.name}</span>
        </div>

        {/* ================= HERO ================= */}
        <div className="bg-white rounded-2xl shadow p-6 sm:p-8">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
            <div className="space-y-2">
              <h1 className="text-2xl sm:text-3xl font-bold">{brand.name}</h1>
              <div className="text-gray-600">
                {brand.name} ilanlarını keşfet. Model seç, filtrele, sırala.
              </div>

              <div className="text-sm text-gray-500 mt-2">
                Toplam:{" "}
                <span className="font-semibold text-gray-800">{totalShow}</span>
                {"  "}• Yüklü:{" "}
                <span className="font-semibold text-gray-800">{loadedCount}</span>
                {"  "}• Sonuç:{" "}
                <span className="font-semibold text-gray-800">
                  {sortedListings.length}
                </span>
                {selectedModel ? (
                  <>
                    {"  "}• Model:{" "}
                    <span className="font-semibold text-gray-800">
                      {selectedModel.name}
                    </span>
                  </>
                ) : null}
              </div>

              <div className="text-xs text-gray-500">
                Not: Filtre sonuçları şu an <b>yüklenen ilanlar</b> üzerinden hesaplanır.
                Çok dar filtrede sonuç azsa “Daha fazla ilan yükle” ile genişlet.
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/new"
                className="bg-green-600 hover:bg-green-700 text-white font-semibold px-5 py-3 rounded-xl text-center"
              >
                + İlan Ver
              </Link>

              <button
                type="button"
                onClick={async () => {
                  try {
                    const url = window.location.href;
                    await navigator.clipboard.writeText(url);
                    alert("Link kopyalandı ✅");
                  } catch {
                    alert("Kopyalama başarısız. Tarayıcı izinlerini kontrol et.");
                  }
                }}
                className="border rounded-xl px-5 py-3 font-semibold hover:bg-gray-50 text-center"
              >
                Linki kopyala
              </button>

              <Link
                href="/"
                className="border rounded-xl px-5 py-3 font-semibold hover:bg-gray-50 text-center"
              >
                ← Ana sayfa
              </Link>
            </div>
          </div>

          {/* ================= SEARCH + MODEL ================= */}
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2">
              <div className="text-xs text-gray-500 mb-1">Marka içinde ara</div>
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="w-full border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-200"
                placeholder="İlan başlığı, model adı..."
              />
              <div className="text-[11px] text-gray-500 mt-1">
                URL senkron ✅ (paylaşılabilir link).
              </div>
            </div>

            <div>
              <div className="text-xs text-gray-500 mb-1">Model seç</div>
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className="w-full border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-200"
              >
                <option value="">Tüm modeller</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({modelCounts[m.id] || 0})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Popüler model chips */}
          {popularModels.length > 0 && (
            <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setModelId("")}
                className={`shrink-0 px-4 py-2 rounded-full border text-sm transition ${
                  modelId === "" ? "bg-gray-100 font-semibold" : "hover:bg-gray-50"
                }`}
              >
                Tümü{" "}
                <span className="ml-1 text-xs text-gray-500">{loadedCount}</span>
              </button>

              {popularModels.slice(0, 14).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModelId(m.id)}
                  className={`shrink-0 px-4 py-2 rounded-full border text-sm transition ${
                    modelId === m.id ? "bg-gray-100 font-semibold" : "hover:bg-gray-50"
                  }`}
                >
                  {m.name}
                  <span className="ml-2 text-xs text-gray-500">
                    {modelCounts[m.id] || 0}
                  </span>
                </button>
              ))}

              {selectedModel && (
                <Link
                  href={`/${brand.nameLower}/${selectedModel.nameLower}`}
                  className="shrink-0 px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
                >
                  Modele git →
                </Link>
              )}
            </div>
          )}
        </div>

        {/* ================= TOOLBAR + QUICK FILTERS ================= */}
        <div className="bg-white rounded-2xl shadow p-4">
          <div className="flex flex-col gap-3">
            {/* top row */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFilterOpen(true)}
                  className="px-4 py-2 border rounded-xl text-sm hover:bg-gray-50"
                >
                  Filtrele
                  {appliedFiltersCount > 0 ? (
                    <span className="ml-2 inline-flex items-center justify-center text-xs bg-gray-900 text-white px-2 py-1 rounded-full">
                      {appliedFiltersCount}
                    </span>
                  ) : null}
                </button>

                {appliedFiltersCount > 0 && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="px-4 py-2 border rounded-xl text-sm hover:bg-gray-50 text-red-600"
                  >
                    Temizle
                  </button>
                )}

                <div className="text-sm text-gray-600">
                  Gösteriliyor:{" "}
                  <span className="font-semibold text-gray-800">
                    {Math.min(visibleListings.length, sortedListings.length)}
                  </span>{" "}
                  / {sortedListings.length}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                {/* Sort */}
                <div className="flex items-center gap-2">
                  <div className="text-xs text-gray-500">Sıralama</div>
                  <select
                    value={sortMode}
                    onChange={(e) =>
                      setSortMode(e.target.value as "newest" | "priceAsc" | "priceDesc")
                    }
                    className="border rounded-xl px-3 py-2 text-sm"
                  >
                    <option value="newest">En yeni</option>
                    <option value="priceAsc">Fiyat (artan)</option>
                    <option value="priceDesc">Fiyat (azalan)</option>
                  </select>
                </div>

                {/* View mode */}
                <div className="flex items-center gap-2">
                  <div className="text-xs text-gray-500">Görünüm</div>
                  <div className="flex border rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setViewMode("grid")}
                      className={`px-3 py-2 text-sm ${
                        viewMode === "grid"
                          ? "bg-gray-100 font-semibold"
                          : "hover:bg-gray-50"
                      }`}
                    >
                      Grid
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("list")}
                      className={`px-3 py-2 text-sm ${
                        viewMode === "list"
                          ? "bg-gray-100 font-semibold"
                          : "hover:bg-gray-50"
                      }`}
                    >
                      Liste
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* quick presets */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => applyPreset("auto")}
                className="px-3 py-2 rounded-full border text-sm hover:bg-gray-50"
              >
                Otomatik
              </button>
              <button
                type="button"
                onClick={() => applyPreset("quartz")}
                className="px-3 py-2 rounded-full border text-sm hover:bg-gray-50"
              >
                Quartz
              </button>
              <button
                type="button"
                onClick={() => applyPreset("year2020")}
                className="px-3 py-2 rounded-full border text-sm hover:bg-gray-50"
              >
                2020+
              </button>
              <button
                type="button"
                onClick={() => applyPreset("size3640")}
                className="px-3 py-2 rounded-full border text-sm hover:bg-gray-50"
              >
                36–40mm
              </button>
              <button
                type="button"
                onClick={() => applyPreset("noWear")}
                className="px-3 py-2 rounded-full border text-sm hover:bg-gray-50"
              >
                Aşınma yok
              </button>
              <button
                type="button"
                onClick={() => applyPreset("under50")}
                className="px-3 py-2 rounded-full border text-sm hover:bg-gray-50"
              >
                50K altı
              </button>

              {brand?.id && hasMore && (
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => fetchMore(brand.id)}
                  className={`px-3 py-2 rounded-full border text-sm ${
                    loadingMore ? "opacity-60 cursor-not-allowed" : "hover:bg-gray-50"
                  }`}
                >
                  {loadingMore ? "Yükleniyor..." : "Daha fazla ilan yükle"}
                </button>
              )}
            </div>

            {/* active badges */}
            {activeBadges.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {activeBadges.map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    onClick={b.onClear}
                    className="text-xs px-3 py-2 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-800 flex items-center gap-2"
                    title="Filtreyi kaldır"
                  >
                    <span className="truncate max-w-[220px]">{b.label}</span>
                    <span className="text-gray-500">✕</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ================= FILTER PANEL ================= */}
        {filterOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-40 flex sm:justify-end justify-center sm:items-stretch items-end"
            onClick={() => setFilterOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              className="bg-white w-full sm:w-[440px] sm:h-full h-[92vh] rounded-t-3xl sm:rounded-none sm:rounded-l-3xl p-5 sm:p-6 space-y-4 overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-lg">Filtreler</div>
                  <div className="text-xs text-gray-500">
                    Sonuç: <span className="font-semibold">{sortedListings.length}</span>
                  </div>
                </div>

                <button
                  onClick={() => setFilterOpen(false)}
                  className="px-3 py-2 rounded-xl hover:bg-gray-100"
                  aria-label="Kapat"
                >
                  ✕
                </button>
              </div>

              <details open className="border rounded-2xl p-4">
                <summary className="font-semibold cursor-pointer select-none">
                  Temel filtreler
                </summary>

                <div className="mt-3 space-y-3">
                  {/* Model */}
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500">Model</div>
                    <select
                      value={modelId}
                      onChange={(e) => setModelId(e.target.value)}
                      className="w-full border rounded-xl px-3 py-2 text-sm"
                    >
                      <option value="">Hepsi</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({modelCounts[m.id] || 0})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Price */}
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500">Fiyat</div>
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        value={minPrice}
                        onChange={(e) => setMinPrice(cleanDigits(e.target.value))}
                        className="w-full border rounded-xl px-3 py-2 text-sm"
                        placeholder="Min"
                        inputMode="numeric"
                      />
                      <input
                        value={maxPrice}
                        onChange={(e) => setMaxPrice(cleanDigits(e.target.value))}
                        className="w-full border rounded-xl px-3 py-2 text-sm"
                        placeholder="Max"
                        inputMode="numeric"
                      />
                    </div>
                  </div>

                  {/* Year */}
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500">Üretim yılı</div>
                    <div className="grid grid-cols-2 gap-3">
                      <select
                        value={yearMin}
                        onChange={(e) => setYearMin(cleanDigits(e.target.value))}
                        className="w-full border rounded-xl px-3 py-2 text-sm"
                      >
                        <option value="">Min</option>
                        {yearOptions.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>

                      <select
                        value={yearMax}
                        onChange={(e) => setYearMax(cleanDigits(e.target.value))}
                        className="w-full border rounded-xl px-3 py-2 text-sm"
                      >
                        <option value="">Max</option>
                        {yearOptions.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Diameter */}
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500">Çap (mm)</div>
                    <div className="grid grid-cols-2 gap-3">
                      <select
                        value={diaMin}
                        onChange={(e) => setDiaMin(cleanDigits(e.target.value))}
                        className="w-full border rounded-xl px-3 py-2 text-sm"
                      >
                        <option value="">Min</option>
                        {diameterOptions.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>

                      <select
                        value={diaMax}
                        onChange={(e) => setDiaMax(cleanDigits(e.target.value))}
                        className="w-full border rounded-xl px-3 py-2 text-sm"
                      >
                        <option value="">Max</option>
                        {diameterOptions.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </details>

              <details className="border rounded-2xl p-4">
                <summary className="font-semibold cursor-pointer select-none">
                  Detay filtreler
                </summary>

                <div className="mt-3 space-y-3">
                  {/* Gender */}
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500">Cinsiyet</div>
                    <select
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                      className="w-full border rounded-xl px-3 py-2 text-sm"
                    >
                      <option value="">Hepsi</option>
                      {genderOptions.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Movement */}
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500">Çalışma şekli</div>
                    <select
                      value={movementType}
                      onChange={(e) => setMovementType(e.target.value)}
                      className="w-full border rounded-xl px-3 py-2 text-sm"
                    >
                      <option value="">Hepsi</option>
                      {movementOptions.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Case */}
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500">Kasa tipi</div>
                    <select
                      value={caseType}
                      onChange={(e) => setCaseType(e.target.value)}
                      className="w-full border rounded-xl px-3 py-2 text-sm"
                    >
                      <option value="">Hepsi</option>
                      {caseTypeOptions.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Bracelet */}
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500">Kordon malzemesi</div>
                    <select
                      value={braceletMaterial}
                      onChange={(e) => setBraceletMaterial(e.target.value)}
                      className="w-full border rounded-xl px-3 py-2 text-sm"
                    >
                      <option value="">Hepsi</option>
                      {braceletMaterialOptions.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Wear */}
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500">Aşınma durumu</div>
                    <select
                      value={wearFilter}
                      onChange={(e) => setWearFilter(e.target.value as any)}
                      className="w-full border rounded-xl px-3 py-2 text-sm"
                    >
                      <option value="">Hepsi</option>
                      <option value="wear">Aşınma var</option>
                      <option value="noWear">Aşınma yok</option>
                    </select>
                  </div>
                </div>
              </details>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={clearFilters}
                  className="border rounded-xl py-3 font-semibold hover:bg-gray-50"
                >
                  Temizle
                </button>
                <button
                  type="button"
                  onClick={() => setFilterOpen(false)}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl"
                >
                  Uygula
                </button>
              </div>

              <div className="text-xs text-gray-500">
                ✅ Filtreler URL’e yazılır (paylaşılabilir). ✅ Liste pagination ile hızlanır.
              </div>
            </div>
          </div>
        )}

        {/* ================= LISTINGS ================= */}
        {visibleListings.length === 0 ? (
          <div className="bg-white rounded-2xl shadow p-8 text-center">
            <div className="text-gray-900 font-semibold">
              Bu filtrelere uygun ilan bulunamadı.
            </div>
            <div className="text-sm text-gray-600 mt-1">
              Filtreleri gevşetebilir veya daha fazla ilan yükleyebilirsin.
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center mt-4">
              <button
                type="button"
                onClick={clearFilters}
                className="bg-gray-900 hover:bg-black text-white font-semibold px-6 py-3 rounded-xl"
              >
                Filtreleri sıfırla
              </button>

              {brand?.id && hasMore && (
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => fetchMore(brand.id)}
                  className={`border rounded-xl px-6 py-3 font-semibold ${
                    loadingMore ? "opacity-60 cursor-not-allowed" : "hover:bg-gray-50"
                  }`}
                >
                  {loadingMore ? "Yükleniyor..." : "Daha fazla ilan yükle"}
                </button>
              )}
            </div>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-5">
            {visibleListings.map((l) => {
              const img = firstImage(l.imageUrls);
              const ago = timeAgoTR(l.createdAt);

              const y = getYearNumber(l.productionYear);
              const dia = getDiaNumber(l.diameterMm ?? null);

              return (
                <Link key={l.id} href={`/ilan/${l.id}`} className="block">
                  <div className="bg-white rounded-2xl shadow hover:shadow-lg transition overflow-hidden border">
                    {img ? (
                      <img
                        src={img}
                        alt={safeText(l.title, "ilan")}
                        className="w-full h-44 object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-44 bg-gray-100 flex items-center justify-center text-gray-400 text-sm">
                        Görsel yok
                      </div>
                    )}

                    <div className="p-4 space-y-2">
                      <div className="font-semibold line-clamp-2">
                        {safeText(l.title, "İlan")}
                      </div>

                      <div className="text-green-700 font-bold">
                        {formatPriceTRY(l.price)}
                      </div>

                      <div className="text-xs text-gray-500">
                        {safeText(l.brandName, brand.name)}
                        {l.modelName ? ` / ${l.modelName}` : ""}
                      </div>

                      <div className="text-xs text-gray-600 flex flex-wrap gap-2">
                        {y ? (
                          <span className="px-2 py-1 rounded-full bg-gray-100">
                            {y}
                          </span>
                        ) : null}

                        {l.gender ? (
                          <span className="px-2 py-1 rounded-full bg-gray-100">
                            {compactLabel(l.gender)}
                          </span>
                        ) : null}

                        {l.movementType ? (
                          <span className="px-2 py-1 rounded-full bg-gray-100">
                            {compactLabel(l.movementType)}
                          </span>
                        ) : null}

                        {dia ? (
                          <span className="px-2 py-1 rounded-full bg-gray-100">
                            {dia}mm
                          </span>
                        ) : null}

                        {l.braceletMaterial ? (
                          <span className="px-2 py-1 rounded-full bg-gray-100">
                            {compactLabel(l.braceletMaterial)}
                          </span>
                        ) : null}

                        {l.wearExists === true ? (
                          <span className="px-2 py-1 rounded-full bg-red-50 text-red-700">
                            Aşınma var
                          </span>
                        ) : l.wearExists === false ? (
                          <span className="px-2 py-1 rounded-full bg-green-50 text-green-700">
                            Aşınma yok
                          </span>
                        ) : null}
                      </div>

                      <div className="text-xs text-gray-400 flex items-center justify-between">
                        <div className="truncate">{safeText(l.modelName, "")}</div>
                        <div className="shrink-0">{ago}</div>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow overflow-hidden border">
            <div className="divide-y">
              {visibleListings.map((l) => {
                const img = firstImage(l.imageUrls);
                const ago = timeAgoTR(l.createdAt);
                const y = getYearNumber(l.productionYear);
                const dia = getDiaNumber(l.diameterMm ?? null);

                return (
                  <Link
                    key={l.id}
                    href={`/ilan/${l.id}`}
                    className="block hover:bg-gray-50 transition"
                  >
                    <div className="p-4 flex gap-4">
                      <div className="w-28 h-20 rounded-xl overflow-hidden bg-gray-100 flex items-center justify-center text-gray-400 text-xs shrink-0">
                        {img ? (
                          <img
                            src={img}
                            alt={safeText(l.title, "ilan")}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          "Görsel yok"
                        )}
                      </div>

                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="font-semibold truncate">
                          {safeText(l.title, "İlan")}
                        </div>

                        <div className="text-sm text-gray-600 truncate">
                          {brand.name}
                          {l.modelName ? ` / ${l.modelName}` : ""}
                        </div>

                        <div className="text-xs text-gray-500 flex flex-wrap gap-2">
                          {y ? <span>{y}</span> : null}
                          {l.gender ? <span>• {l.gender}</span> : null}
                          {l.movementType ? <span>• {l.movementType}</span> : null}
                          {dia ? <span>• {dia}mm</span> : null}
                          {l.braceletMaterial ? (
                            <span>• {l.braceletMaterial}</span>
                          ) : null}
                          {l.wearExists === true ? (
                            <span className="text-red-600">• Aşınma var</span>
                          ) : l.wearExists === false ? (
                            <span className="text-green-600">• Aşınma yok</span>
                          ) : null}
                        </div>

                        <div className="text-xs text-gray-400">{ago}</div>
                      </div>

                      <div className="text-green-700 font-bold shrink-0">
                        {formatPriceTRY(l.price)}
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
              className="bg-gray-900 hover:bg-black text-white font-semibold px-6 py-3 rounded-xl"
            >
              Daha fazla göster
            </button>
          )}

          {brand?.id && hasMore && (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => fetchMore(brand.id)}
              className={`border rounded-xl px-6 py-3 font-semibold ${
                loadingMore ? "opacity-60 cursor-not-allowed" : "hover:bg-gray-50"
              }`}
            >
              {loadingMore ? "Yükleniyor..." : "Firestore'dan yeni ilanlar yükle"}
            </button>
          )}

          {!hasMore && (
            <div className="text-xs text-gray-500">
              Tüm ilanlar yüklendi ✅
            </div>
          )}
        </div>

        {/* ================= BRAND INFO ================= */}
        <div className="bg-white rounded-2xl shadow p-8 space-y-4">
          <h2 className="text-xl font-bold">{brand.name} hakkında</h2>

          <div className="text-gray-700 leading-relaxed">
            Bu sayfada {brand.name} markasına ait ilanları görürsün. Üstten model seçebilir,
            filtre panelinden üretim yılı, fiyat, mekanizma, çap gibi kriterlerle listeyi
            özelleştirebilirsin. Filtreler URL’e yazıldığı için linki birine atabilirsin.
          </div>

          <div className="border rounded-xl p-4 bg-gray-50 text-sm text-gray-700">
            <div className="font-semibold mb-2">Hızlı kullanım</div>
            <ul className="list-disc pl-5 space-y-1">
              <li>Popüler modellerden birine tıklayarak modele özel sayfaya geç.</li>
              <li>Filtrele ile aradığın özellikleri seçip listeyi daralt.</li>
              <li>Linki kopyala ile filtreli aramayı paylaş.</li>
              <li>İlan az görünüyorsa “Firestore’dan yeni ilanlar yükle” ile genişlet.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
