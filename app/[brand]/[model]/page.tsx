"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useParams,
  useRouter,
  usePathname,
  useSearchParams,
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
  brandId: string;
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
  serialNumber?: string;
  movementType?: string;

  caseType?: string;
  diameterMm?: number | null;
  dialColor?: string;

  braceletMaterial?: string;
  braceletColor?: string;

  wearExists?: boolean;
  accessories?: string;

  description?: string;

  createdAt?: any;
  imageUrls?: string[];

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

export default function ModelPage() {
  const params = useParams<{ brand: string; model: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const brandSlug = params?.brand;
  const modelSlug = params?.model;

  const [brand, setBrand] = useState<Brand | null>(null);
  const [model, setModel] = useState<Model | null>(null);

  // ✅ Firestore pagination listings
  const [listings, setListings] = useState<Listing[]>([]);
  const [lastDoc, setLastDoc] =
    useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const [loading, setLoading] = useState(true); // initial
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ================= UI STATES ================= */

  const [viewMode, setViewMode] = useState<(typeof VIEW_OPTIONS)[number]>("grid");

  const [sortMode, setSortMode] = useState<(typeof SORT_OPTIONS)[number]>("newest");

  // fetch size per page
  const [pageSize, setPageSize] = useState<24 | 48 | 96>(24);

  const [filterOpen, setFilterOpen] = useState(false);

  /* ================= FILTER STATES ================= */

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

  const clearFilters = () => {
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
  };

  const appliedFiltersCount = useMemo(() => {
    let c = 0;
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
    return c;
  }, [
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
  ]);

  /* ================= URL INIT (✅ URL’den filtre oku) ================= */

  const urlHydratingRef = useRef(false);
  const urlReadyRef = useRef(false);

  useEffect(() => {
    if (!brandSlug || !modelSlug) return;

    // Her route değişiminde URL init tekrar yapılır
    urlHydratingRef.current = true;
    urlReadyRef.current = false;

    const sp = new URLSearchParams(searchParams?.toString() || "");

    setSortMode(pickEnum(sp.get("sort"), SORT_OPTIONS, "newest"));
    setViewMode(pickEnum(sp.get("view"), VIEW_OPTIONS, "grid"));
    setPageSize(pickPageSize(sp.get("ps"), 24));

    setMinPrice(cleanParam(sp.get("minPrice") || "").replace(/[^\d]/g, ""));
    setMaxPrice(cleanParam(sp.get("maxPrice") || "").replace(/[^\d]/g, ""));

    setYearMin(cleanParam(sp.get("yearMin") || ""));
    setYearMax(cleanParam(sp.get("yearMax") || ""));

    setGender(cleanParam(sp.get("gender") || ""));
    setMovementType(cleanParam(sp.get("movement") || ""));
    setCaseType(cleanParam(sp.get("caseType") || ""));
    setBraceletMaterial(cleanParam(sp.get("bracelet") || ""));

    setDiaMin(cleanParam(sp.get("diaMin") || ""));
    setDiaMax(cleanParam(sp.get("diaMax") || ""));

    setWearFilter(pickEnum(sp.get("wear"), ["", "wear", "noWear"] as const, ""));

    // ✅ URL hazır
    setTimeout(() => {
      urlHydratingRef.current = false;
      urlReadyRef.current = true;
    }, 0);
  }, [brandSlug, modelSlug, searchParams]);

  /* ================= URL SYNC (✅ filtreler değişince URL yaz) ================= */

  useEffect(() => {
    if (!pathname) return;
    if (!urlReadyRef.current) return;
    if (urlHydratingRef.current) return;

    const sp = new URLSearchParams();

    // defaults yazma -> URL temiz kalsın
    if (sortMode !== "newest") sp.set("sort", sortMode);
    if (viewMode !== "grid") sp.set("view", viewMode);
    if (pageSize !== 24) sp.set("ps", String(pageSize));

    if (minPrice.trim()) sp.set("minPrice", minPrice.trim());
    if (maxPrice.trim()) sp.set("maxPrice", maxPrice.trim());

    if (yearMin.trim()) sp.set("yearMin", yearMin.trim());
    if (yearMax.trim()) sp.set("yearMax", yearMax.trim());

    if (gender.trim()) sp.set("gender", gender.trim());
    if (movementType.trim()) sp.set("movement", movementType.trim());
    if (caseType.trim()) sp.set("caseType", caseType.trim());
    if (braceletMaterial.trim()) sp.set("bracelet", braceletMaterial.trim());

    if (diaMin.trim()) sp.set("diaMin", diaMin.trim());
    if (diaMax.trim()) sp.set("diaMax", diaMax.trim());

    if (wearFilter) sp.set("wear", wearFilter);

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
  ]);

  /* ================= LOAD BRAND + MODEL ================= */

  useEffect(() => {
    if (!brandSlug || !modelSlug) return;

    let cancelled = false;

    async function loadBrandModel() {
      setLoading(true);
      setError(null);

      try {
        // BRAND
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

        // MODEL
        const modelSnap = await getDocs(
          query(
            collection(db, "models"),
            where("nameLower", "==", modelSlug),
            where("brandId", "==", b.id)
          )
        );
        if (modelSnap.empty) throw new Error("Model bulunamadı.");

        const mDoc = modelSnap.docs[0];
        const m: Model = {
          id: mDoc.id,
          name: mDoc.data().name,
          nameLower: mDoc.data().nameLower,
          brandId: mDoc.data().brandId,
        };

        if (cancelled) return;
        setModel(m);
      } catch (e: any) {
        console.error(e);
        if (!cancelled) setError(e?.message || "Bir hata oluştu.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadBrandModel();

    return () => {
      cancelled = true;
    };
  }, [brandSlug, modelSlug]);

  /* ================= FIRESTORE PAGINATION (✅ 2000 ilan uçurur) ================= */

  const serverQueryKey = useMemo(() => {
    // server tarafında gerçekten query değiştirip reset gerektiren şeyler:
    // sortMode, pageSize, wearFilter, gender, movementType, caseType, braceletMaterial
    // (min/max price sadece price sıralamasında server tarafına eklenir)
    const priceKey =
      sortMode === "priceAsc" || sortMode === "priceDesc"
        ? `${minPrice || ""}-${maxPrice || ""}`
        : ""; // newest'te fiyat range client-side

    return [
      model?.id || "",
      sortMode,
      String(pageSize),
      wearFilter || "",
      gender || "",
      movementType || "",
      caseType || "",
      braceletMaterial || "",
      priceKey,
    ].join("|");
  }, [
    model?.id,
    sortMode,
    pageSize,
    wearFilter,
    gender,
    movementType,
    caseType,
    braceletMaterial,
    minPrice,
    maxPrice,
  ]);

  const fetchPage = async (reset: boolean) => {
    if (!model?.id) return;
    if (reset) {
      setLoading(true);
      setHasMore(true);
      setLastDoc(null);
      setListings([]);
    } else {
      if (loadingMore) return;
      setLoadingMore(true);
    }

    try {
      const constraints: any[] = [where("modelId", "==", model.id)];

      // ✅ eşitlik filtreleri server-side (index isteyebilir)
      if (wearFilter === "wear") constraints.push(where("wearExists", "==", true));
      if (wearFilter === "noWear") constraints.push(where("wearExists", "==", false));

      if (gender.trim()) constraints.push(where("gender", "==", gender.trim()));
      if (movementType.trim())
        constraints.push(where("movementType", "==", movementType.trim()));
      if (caseType.trim()) constraints.push(where("caseType", "==", caseType.trim()));
      if (braceletMaterial.trim())
        constraints.push(where("braceletMaterial", "==", braceletMaterial.trim()));

      // ✅ sort + (fiyat sort’ta min/max server-side uygulanabilir)
      const minP = toNumOrNull(minPrice);
      const maxP = toNumOrNull(maxPrice);

      if (sortMode === "newest") {
        constraints.push(orderBy("createdAt", "desc"));
      } else if (sortMode === "priceAsc") {
        if (minP !== null) constraints.push(where("price", ">=", minP));
        if (maxP !== null) constraints.push(where("price", "<=", maxP));
        constraints.push(orderBy("price", "asc"));
        constraints.push(orderBy("createdAt", "desc"));
      } else if (sortMode === "priceDesc") {
        if (minP !== null) constraints.push(where("price", ">=", minP));
        if (maxP !== null) constraints.push(where("price", "<=", maxP));
        constraints.push(orderBy("price", "desc"));
        constraints.push(orderBy("createdAt", "desc"));
      }

      constraints.push(limit(pageSize));

      // startAfter
      const cursor = reset ? null : lastDoc;
      if (cursor) constraints.push(startAfter(cursor));

      const snap = await getDocs(query(collection(db, "listings"), ...constraints));

      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      })) as Listing[];

      const newLast =
        snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;

      setLastDoc(newLast);
      setHasMore(snap.docs.length === pageSize);

      if (reset) {
        // ✅ reset’te direkt yaz
        setListings(items);
      } else {
        // ✅ append’te dedupe (duplicate key fix)
        setListings((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          const merged = [...prev];
          for (const it of items) {
            if (!seen.has(it.id)) {
              merged.push(it);
              seen.add(it.id);
            }
          }
          return merged;
        });
      }
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Liste yüklenemedi.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // ✅ query değişince reset + ilk sayfa çek
  useEffect(() => {
    if (!model?.id) return;
    if (!urlReadyRef.current) return;
    if (urlHydratingRef.current) return;

    fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverQueryKey, model?.id]);

  /* ================= CLIENT FILTER (year + diameter gibi) ================= */

  const filteredListings = useMemo(() => {
    const yMin = toIntOrNull(yearMin);
    const yMax = toIntOrNull(yearMax);

    const dMin = toNumOrNull(diaMin);
    const dMax = toNumOrNull(diaMax);

    return listings.filter((l) => {
      const y = getYearNumber(l.productionYear);
      if (yMin !== null) {
        if (y === null || y < yMin) return false;
      }
      if (yMax !== null) {
        if (y === null || y > yMax) return false;
      }

      const dia = getDiaNumber(l.diameterMm ?? null);
      if (dMin !== null) {
        if (dia === null || dia < dMin) return false;
      }
      if (dMax !== null) {
        if (dia === null || dia > dMax) return false;
      }

      // newest modunda fiyat min/max client-side çalışsın
      if (sortMode === "newest") {
        const minP = toNumOrNull(minPrice);
        const maxP = toNumOrNull(maxPrice);
        const p = Number(l.price);
        const ok = Number.isFinite(p);

        if (minP !== null) {
          if (!ok || p < minP) return false;
        }
        if (maxP !== null) {
          if (!ok || p > maxP) return false;
        }
      }

      return true;
    });
  }, [listings, yearMin, yearMax, diaMin, diaMax, sortMode, minPrice, maxPrice]);

  /* ================= UI STATES ================= */

  if (loading && !brand && !model) {
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

  if (!brand || !model) return null;

  /* ================= UI ================= */

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-7xl mx-auto px-4 py-10 space-y-8">
        {/* ================= BREADCRUMB ================= */}
        <div className="text-sm text-gray-600">
          <Link href="/" className="hover:underline">
            Ana sayfa
          </Link>
          <span className="mx-2">/</span>
          <Link href={`/${brand.nameLower}`} className="hover:underline">
            {brand.name}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-gray-900 font-medium">{model.name}</span>
        </div>

        {/* ================= HERO ================= */}
        <div className="bg-white rounded-2xl shadow p-8">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold">
                {brand.name} / {model.name}
              </h1>
              <div className="text-gray-600">
                Bu model için ilanlar. Filtrele, sırala, sayfalı yükle.
              </div>

              <div className="text-sm text-gray-500 mt-2">
                Yüklendi:{" "}
                <span className="font-semibold text-gray-800">
                  {listings.length}
                </span>
                {"  "}
                • Filtre sonucu (yüklenen içinde):{" "}
                <span className="font-semibold text-gray-800">
                  {filteredListings.length}
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/new"
                className="bg-green-600 hover:bg-green-700 text-white font-semibold px-5 py-3 rounded-xl text-center"
              >
                + İlan Ver
              </Link>

              <Link
                href={`/${brand.nameLower}`}
                className="border rounded-xl px-5 py-3 font-semibold hover:bg-gray-50 text-center"
              >
                ← Markaya dön
              </Link>
            </div>
          </div>
        </div>

        {/* ================= TOOLBAR ================= */}
        <div className="bg-white rounded-2xl shadow p-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setFilterOpen(true)}
                className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
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
                  className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50 text-red-600"
                >
                  Temizle
                </button>
              )}

              <div className="text-sm text-gray-600">
                Gösteriliyor:{" "}
                <span className="font-semibold text-gray-800">
                  {filteredListings.length}
                </span>
                {hasMore ? (
                  <span className="ml-2 text-xs text-gray-400">
                    (daha fazlası var)
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              {/* Sort */}
              <div className="flex items-center gap-2">
                <div className="text-xs text-gray-500">Sıralama</div>
                <select
                  value={sortMode}
                  onChange={(e) =>
                    setSortMode(
                      pickEnum(e.target.value, SORT_OPTIONS, "newest")
                    )
                  }
                  className="border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="newest">En yeni</option>
                  <option value="priceAsc">Fiyat (artan)</option>
                  <option value="priceDesc">Fiyat (azalan)</option>
                </select>
              </div>

              {/* Page size */}
              <div className="flex items-center gap-2">
                <div className="text-xs text-gray-500">Sayfa</div>
                <select
                  value={pageSize}
                  onChange={(e) =>
                    setPageSize(pickPageSize(e.target.value, 24))
                  }
                  className="border rounded-lg px-3 py-2 text-sm"
                >
                  <option value={24}>24</option>
                  <option value={48}>48</option>
                  <option value={96}>96</option>
                </select>
              </div>

              {/* View mode */}
              <div className="flex items-center gap-2">
                <div className="text-xs text-gray-500">Görünüm</div>
                <div className="flex border rounded-lg overflow-hidden">
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
        </div>

        {/* ================= FILTER PANEL ================= */}
        {filterOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-40 flex justify-end"
            onClick={() => setFilterOpen(false)}
          >
            <div
              className="bg-white w-full sm:w-[420px] h-full p-6 space-y-5 overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-semibold text-lg">Filtreler</div>
                  <div className="text-xs text-gray-500">
                    Filtre sonucu:{" "}
                    <span className="font-semibold">{filteredListings.length}</span>
                  </div>
                </div>

                <button
                  onClick={() => setFilterOpen(false)}
                  className="px-2 py-1 rounded hover:bg-gray-100"
                >
                  ✕
                </button>
              </div>

              {/* Price */}
              <div className="border rounded-2xl p-4 space-y-3">
                <div className="font-semibold">Fiyat</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500">Min</div>
                    <input
                      value={minPrice}
                      onChange={(e) =>
                        setMinPrice(e.target.value.replace(/[^\d]/g, ""))
                      }
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      placeholder="0"
                      inputMode="numeric"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500">Max</div>
                    <input
                      value={maxPrice}
                      onChange={(e) =>
                        setMaxPrice(e.target.value.replace(/[^\d]/g, ""))
                      }
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      placeholder="500000"
                      inputMode="numeric"
                    />
                  </div>
                </div>

                <div className="text-xs text-gray-500">
                  Not: “En yeni” sıralamada fiyat filtreleri client-side, fiyat sıralamada
                  server-side olur.
                </div>
              </div>

              {/* Year */}
              <div className="border rounded-2xl p-4 space-y-3">
                <div className="font-semibold">Üretim yılı</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500">Min</div>
                    <select
                      value={yearMin}
                      onChange={(e) => setYearMin(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">Seç</option>
                      {yearOptions.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs text-gray-500">Max</div>
                    <select
                      value={yearMax}
                      onChange={(e) => setYearMax(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">Seç</option>
                      {yearOptions.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="text-xs text-gray-500">
                  Not: Üretim yılı boşsa bu filtreye takılır.
                </div>
              </div>

              {/* Gender */}
              <div className="border rounded-2xl p-4 space-y-3">
                <div className="font-semibold">Cinsiyet</div>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
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
              <div className="border rounded-2xl p-4 space-y-3">
                <div className="font-semibold">Çalışma şekli</div>
                <select
                  value={movementType}
                  onChange={(e) => setMovementType(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
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
              <div className="border rounded-2xl p-4 space-y-3">
                <div className="font-semibold">Kasa tipi</div>
                <select
                  value={caseType}
                  onChange={(e) => setCaseType(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Hepsi</option>
                  {caseTypeOptions.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </div>

              {/* Diameter */}
              <div className="border rounded-2xl p-4 space-y-3">
                <div className="font-semibold">Çap (mm)</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500">Min</div>
                    <select
                      value={diaMin}
                      onChange={(e) => setDiaMin(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">Seç</option>
                      {diameterOptions.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs text-gray-500">Max</div>
                    <select
                      value={diaMax}
                      onChange={(e) => setDiaMax(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">Seç</option>
                      {diameterOptions.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Bracelet Material */}
              <div className="border rounded-2xl p-4 space-y-3">
                <div className="font-semibold">Kordon malzemesi</div>
                <select
                  value={braceletMaterial}
                  onChange={(e) => setBraceletMaterial(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
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
              <div className="border rounded-2xl p-4 space-y-3">
                <div className="font-semibold">Aşınma durumu</div>
                <select
                  value={wearFilter}
                  onChange={(e) => setWearFilter(e.target.value as any)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Hepsi</option>
                  <option value="wear">Aşınma var</option>
                  <option value="noWear">Aşınma yok</option>
                </select>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={clearFilters}
                  className="flex-1 border rounded-xl py-3 font-semibold hover:bg-gray-50"
                >
                  Temizle
                </button>
                <button
                  type="button"
                  onClick={() => setFilterOpen(false)}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl"
                >
                  Uygula
                </button>
              </div>

              <div className="text-xs text-gray-500">
                ✅ URL’e yazılır → paylaşılabilir link olur.  
                ✅ Firestore pagination var → 2000 ilanda da hız korunur.
                <br />
                Not: Bazı filtre kombinasyonları Firestore “index” isteyebilir. Hata verirse Firebase Console sana index linki verir.
              </div>
            </div>
          </div>
        )}

        {/* ================= LISTINGS ================= */}
        {filteredListings.length === 0 ? (
          <div className="bg-white rounded-2xl shadow p-8 text-gray-600">
            Bu filtrelere uygun ilan bulunamadı.
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {filteredListings.map((l) => {
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
                        <div className="truncate">{safeText(l.brandName, brand.name)}</div>
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
              {filteredListings.map((l) => {
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
                          {brand.name} / {model.name}
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

        {/* ================= LOAD MORE ================= */}
        {hasMore && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => fetchPage(false)}
              disabled={loadingMore}
              className={`px-6 py-3 rounded-xl font-semibold text-white ${
                loadingMore ? "bg-gray-400 cursor-not-allowed" : "bg-gray-900 hover:bg-black"
              }`}
            >
              {loadingMore ? "Yükleniyor..." : "Daha fazla göster"}
            </button>
          </div>
        )}

        {/* ================= MODEL INFO ================= */}
        <div className="bg-white rounded-2xl shadow p-8 space-y-4">
          <h2 className="text-xl font-bold">
            {brand.name} {model.name} hakkında
          </h2>

          <div className="text-gray-700 leading-relaxed">
            Bu sayfada {brand.name} / {model.name} modeline ait ilanları görürsün.
            Filtreleri URL’e yazdığı için linki paylaşınca aynı filtreli ekran açılır.
          </div>

          <div className="border rounded-xl p-4 bg-gray-50 text-sm text-gray-700">
            <div className="font-semibold mb-2">Alıcı için küçük ipuçları</div>
            <ul className="list-disc pl-5 space-y-1">
              <li>Fotoğrafları büyütüp kasa/bezeli ve kadran detaylarına bak.</li>
              <li>Servis geçmişi, kutu/belge, seri numarası gibi bilgileri sor.</li>
              <li>Pazarlığı mesajlaşmada netleştir.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
