"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  startAfter,
  DocumentData,
  QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

/* =======================
   TYPES
======================= */

type Listing = {
  id: string;
  title?: string;
  price?: number;

  brandId?: string;
  brandName?: string;

  modelId?: string;
  modelName?: string;

  imageUrls?: string[];
  createdAt?: any;

  movementType?: string; // Otomatik / Quartz / Manual / Diğer
  gender?: string; // Erkek / Kadın / Unisex / Diğer
  accessories?: string; // Label olarak: "Orijinal kutu..." vs
  wearExists?: boolean;

  // ✅ yeni sistem: wearLevel (label)
  wearLevel?: string; // "Aşınma yok" / "Hafif aşınma" / ...
};

type Brand = {
  id: string;
  name: string;
  nameLower?: string; // slug
};

type Model = {
  id: string;
  name: string;
  nameLower?: string; // slug
  brandId: string;
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

const accessoriesValueFromLabel = (label?: string) => {
  const v = normalizeText(label || "");
  if (v === "Orijinal kutu ve orijinal belgeler") return "both";
  if (v === "Orijinal kutu") return "box";
  if (v === "Orijinal belgeler") return "papers";
  if (v === "Başka aksesuar yok") return "none";
  return "";
};

const wearLevelValueFromLabel = (label?: string) => {
  const v = normalizeText(label || "");
  if (v === "Aşınma yok") return "none";
  if (v === "Hafif aşınma") return "light";
  if (v === "Orta aşınma") return "medium";
  if (v === "Belirgin aşınma") return "heavy";
  return "";
};

const clampInt = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.trunc(n)));

/* =======================
   URL HELPERS (✅ pickEnum fix)
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

const MOVEMENT_OPTIONS = ["", "Otomatik", "Quartz", "Manual", "Diğer"] as const;
const GENDER_OPTIONS = ["", "Erkek", "Kadın", "Unisex", "Diğer"] as const;
const ACCESSORY_OPTIONS = ["", "both", "box", "papers", "none"] as const;
const WEAR_OPTIONS = ["", "none", "light", "medium", "heavy"] as const;
const SORT_OPTIONS = ["newest", "price_asc", "price_desc"] as const;

// Firestore pagination limit (son ilanları sayfa sayfa çeker)
const LISTINGS_PAGE_SIZE = 200;

// UI’de ekranda gösterim artışı
const UI_STEP = 24;
const UI_MAX = 240;

/* =======================
   PAGE
======================= */

export default function Home() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string>("");

  // data
  const [brands, setBrands] = useState<Brand[]>([]);
  const [models, setModels] = useState<Model[]>([]);

  // ✅ listings pagination
  const [recentListings, setRecentListings] = useState<Listing[]>([]);
  const [lastListingDoc, setLastListingDoc] =
    useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMoreListings, setHasMoreListings] = useState(true);
  const [loadingMoreListings, setLoadingMoreListings] = useState(false);

  // UI visible limit
  const [displayLimit, setDisplayLimit] = useState<number>(24);

  /* =======================
     FILTER STATE
  ======================= */

  const [searchText, setSearchText] = useState("");

  const [movementFilter, setMovementFilter] = useState<
    "" | "Otomatik" | "Quartz" | "Manual" | "Diğer"
  >("");

  const [genderFilter, setGenderFilter] = useState<
    "" | "Erkek" | "Kadın" | "Unisex" | "Diğer"
  >("");

  const [accessoriesFilter, setAccessoriesFilter] = useState<
    "" | "both" | "box" | "papers" | "none"
  >("");

  const [wearFilter, setWearFilter] = useState<
    "" | "none" | "light" | "medium" | "heavy"
  >("");

  const [priceMin, setPriceMin] = useState<string>("");
  const [priceMax, setPriceMax] = useState<string>("");

  const [sortBy, setSortBy] = useState<(typeof SORT_OPTIONS)[number]>("newest");

  // mobile UX
  const [filtersOpen, setFiltersOpen] = useState(false);

  const resetFilters = () => {
    setSearchText("");
    setMovementFilter("");
    setGenderFilter("");
    setAccessoriesFilter("");
    setWearFilter("");
    setPriceMin("");
    setPriceMax("");
    setSortBy("newest");
    setDisplayLimit(24);
  };

  /* =======================
     URL INIT (✅ URL’den filtre oku)
  ======================= */

  const urlHydratingRef = useRef(false);
  const urlReadyRef = useRef(false);

  useEffect(() => {
    // route açıldığında URL -> state
    urlHydratingRef.current = true;
    urlReadyRef.current = false;

    const sp = new URLSearchParams(searchParams?.toString() || "");

    const q = cleanParam(sp.get("q") || "");
    setSearchText(q);

    setMovementFilter(pickEnum(sp.get("mv"), MOVEMENT_OPTIONS, ""));
    setGenderFilter(pickEnum(sp.get("g"), GENDER_OPTIONS, ""));
    setAccessoriesFilter(pickEnum(sp.get("acc"), ACCESSORY_OPTIONS, ""));
    setWearFilter(pickEnum(sp.get("wear"), WEAR_OPTIONS, ""));

    setPriceMin(cleanParam(sp.get("pmin") || "").replace(/[^\d]/g, ""));
    setPriceMax(cleanParam(sp.get("pmax") || "").replace(/[^\d]/g, ""));

    setSortBy(pickEnum(sp.get("sort"), SORT_OPTIONS, "newest"));

    const dlRaw = Number(sp.get("dl") || "");
    const dl = Number.isFinite(dlRaw) ? clampInt(dlRaw, 24, UI_MAX) : 24;
    setDisplayLimit(dl);

    // ✅ URL hazır
    setTimeout(() => {
      urlHydratingRef.current = false;
      urlReadyRef.current = true;
    }, 0);
  }, [searchParams]);

  /* =======================
     URL SYNC (✅ filtreler değişince URL yaz)
  ======================= */

  useEffect(() => {
    if (!pathname) return;
    if (!urlReadyRef.current) return;
    if (urlHydratingRef.current) return;

    const sp = new URLSearchParams();

    if (searchText.trim()) sp.set("q", searchText.trim());
    if (movementFilter) sp.set("mv", movementFilter);
    if (genderFilter) sp.set("g", genderFilter);
    if (accessoriesFilter) sp.set("acc", accessoriesFilter);
    if (wearFilter) sp.set("wear", wearFilter);

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
    movementFilter,
    genderFilter,
    accessoriesFilter,
    wearFilter,
    priceMin,
    priceMax,
    sortBy,
    displayLimit,
  ]);

  /* =======================
     LOAD (brands + models + first page listings)
  ======================= */

  useEffect(() => {
    let cancelled = false;

    async function loadFirst() {
      setLoading(true);
      setFatalError("");

      try {
        const brandsQ = query(
          collection(db, "brands"),
          orderBy("nameLower", "asc"),
          limit(2000)
        );

        const modelsQ = query(
          collection(db, "models"),
          orderBy("nameLower", "asc"),
          limit(5000)
        );

        const listingsQ = query(
          collection(db, "listings"),
          orderBy("createdAt", "desc"),
          limit(LISTINGS_PAGE_SIZE)
        );

        const [bSnap, mSnap, lSnap] = await Promise.all([
          getDocs(brandsQ),
          getDocs(modelsQ),
          getDocs(listingsQ),
        ]);

        if (cancelled) return;

        const b = bSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as Brand[];

        const m = mSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as Model[];

        const rawL = lSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as Listing[];

        // ✅ DEDUPE (duplicate key fix)
        const seen = new Set<string>();
        const l: Listing[] = [];
        for (const item of rawL) {
          if (!item?.id) continue;
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          l.push(item);
        }

        setBrands(Array.isArray(b) ? b : []);
        setModels(Array.isArray(m) ? m : []);
        setRecentListings(l);

        const newLast =
          lSnap.docs.length > 0 ? lSnap.docs[lSnap.docs.length - 1] : null;

        setLastListingDoc(newLast);
        setHasMoreListings(lSnap.docs.length === LISTINGS_PAGE_SIZE);
      } catch (e: any) {
        console.error("Home load error:", e);
        if (!cancelled) {
          setFatalError(e?.message || "Anasayfa verileri yüklenirken hata oluştu.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadFirst();
    return () => {
      cancelled = true;
    };
  }, []);

  /* =======================
     LOAD MORE LISTINGS (pagination + dedupe)
  ======================= */

  const loadMoreListings = async () => {
    if (loadingMoreListings) return;
    if (!hasMoreListings) return;
    if (!lastListingDoc) return;

    setLoadingMoreListings(true);

    try {
      const qMore = query(
        collection(db, "listings"),
        orderBy("createdAt", "desc"),
        startAfter(lastListingDoc),
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

      // ✅ append + dedupe
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
      console.error("loadMoreListings error:", e);
    } finally {
      setLoadingMoreListings(false);
    }
  };

  /* =======================
     DERIVED: Trend brands/models
  ======================= */

  const brandById = useMemo(() => {
    const map = new Map<string, Brand>();
    for (const b of brands) map.set(b.id, b);
    return map;
  }, [brands]);

  const modelById = useMemo(() => {
    const map = new Map<string, Model>();
    for (const m of models) map.set(m.id, m);
    return map;
  }, [models]);

  const topBrands = useMemo(() => {
    const counts = new Map<string, number>();

    for (const l of recentListings) {
      const id = (l.brandId || "").trim();
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([brandId, count]) => {
        const b = brandById.get(brandId);
        const fallbackName = safeText(
          recentListings.find((x) => x.brandId === brandId)?.brandName,
          "Bilinmeyen Marka"
        );

        return {
          brandId,
          count,
          name: b?.name || fallbackName,
          slug: b?.nameLower || toSlugTR(b?.name || fallbackName || "marka"),
        };
      });
  }, [recentListings, brandById]);

  const topModels = useMemo(() => {
    const counts = new Map<string, number>();

    for (const l of recentListings) {
      const id = (l.modelId || "").trim();
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([modelId, count]) => {
        const m = modelById.get(modelId);
        const brandId =
          m?.brandId ||
          recentListings.find((x) => x.modelId === modelId)?.brandId ||
          "";
        const b = brandById.get(brandId);

        const brandSlug =
          b?.nameLower ||
          toSlugTR(
            b?.name ||
              recentListings.find((x) => x.modelId === modelId)?.brandName ||
              "marka"
          );

        const modelSlug =
          m?.nameLower ||
          toSlugTR(
            m?.name ||
              recentListings.find((x) => x.modelId === modelId)?.modelName ||
              "model"
          );

        return {
          modelId,
          count,
          name:
            m?.name ||
            safeText(
              recentListings.find((x) => x.modelId === modelId)?.modelName,
              "Bilinmeyen Model"
            ),
          brandName:
            b?.name ||
            safeText(
              recentListings.find((x) => x.modelId === modelId)?.brandName,
              "Marka"
            ),
          href: `/${brandSlug}/${modelSlug}`,
        };
      });
  }, [recentListings, modelById, brandById]);

  /* =======================
     FILTERING (client-side)
  ======================= */

  const filteredListings = useMemo(() => {
    const q = searchText.trim().toLowerCase();

    const min = priceMin.trim() ? Number(priceMin.trim()) : null;
    const max = priceMax.trim() ? Number(priceMax.trim()) : null;

    let arr = recentListings.slice();

    arr = arr.filter((l) => {
      // search
      if (q) {
        const hay = [
          l.title || "",
          l.brandName || "",
          l.modelName || "",
          l.movementType || "",
          l.gender || "",
          l.accessories || "",
          l.wearLevel || "",
        ]
          .join(" ")
          .toLowerCase();

        if (!hay.includes(q)) return false;
      }

      // movement
      if (movementFilter) {
        if (normalizeText(l.movementType || "") !== movementFilter) return false;
      }

      // gender
      if (genderFilter) {
        if (normalizeText(l.gender || "") !== genderFilter) return false;
      }

      // accessories (label->value)
      if (accessoriesFilter) {
        const v = accessoriesValueFromLabel(l.accessories);
        if (v !== accessoriesFilter) return false;
      }

      // wear level
      if (wearFilter) {
        const v = wearLevelValueFromLabel(l.wearLevel);
        const fallback = v || (l.wearExists ? "medium" : "none");
        if (fallback !== wearFilter) return false;
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
    movementFilter,
    genderFilter,
    accessoriesFilter,
    wearFilter,
    priceMin,
    priceMax,
    sortBy,
  ]);

  const gridListings = useMemo(() => {
    return filteredListings.slice(0, displayLimit);
  }, [filteredListings, displayLimit]);

  const totalFound = filteredListings.length;

  /* =======================
     QUICK DISCOVERY (PRESETS)
  ======================= */

  const applyPreset = (preset: string) => {
    setDisplayLimit(24);

    if (preset === "auto") {
      setMovementFilter("Otomatik");
      setSortBy("newest");
      return;
    }
    if (preset === "quartz") {
      setMovementFilter("Quartz");
      setSortBy("newest");
      return;
    }
    if (preset === "unisex") {
      setGenderFilter("Unisex");
      setSortBy("newest");
      return;
    }
    if (preset === "fullset") {
      setAccessoriesFilter("both");
      setSortBy("newest");
      return;
    }
    if (preset === "wear_none") {
      setWearFilter("none");
      setSortBy("newest");
      return;
    }
    if (preset === "wear_light") {
      setWearFilter("light");
      setSortBy("newest");
      return;
    }
    if (preset === "cheap") {
      setPriceMin("");
      setPriceMax("20000");
      setSortBy("price_asc");
      return;
    }
    if (preset === "luxury") {
      setPriceMin("100000");
      setPriceMax("");
      setSortBy("newest");
      return;
    }
  };

  /* =======================
     SHOW MORE (UI + fetch more if needed)
  ======================= */

  const handleShowMore = async () => {
    const nextLimit = clampInt(displayLimit + UI_STEP, 24, UI_MAX);

    // Eğer kullanıcı daha fazla görmek istiyor ama elimizde yeterli ilan yoksa:
    // önce Firestore’dan yeni sayfa çek
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
      <div className="min-h-screen bg-gray-100 px-4 py-10">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="bg-white rounded-2xl shadow p-8">
            <div className="h-8 w-64 bg-gray-200 rounded mb-3" />
            <div className="h-4 w-96 bg-gray-200 rounded mb-6" />
            <div className="h-12 w-full bg-gray-200 rounded" />
          </div>

          <div className="bg-white rounded-2xl shadow p-8">
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
      <div className="min-h-screen bg-gray-100 px-4 py-10">
        <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow p-8 text-center">
          <div className="text-red-700 font-semibold mb-2">Hata</div>
          <div className="text-gray-700 mb-6">{fatalError}</div>
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
    <div className="min-h-screen bg-gray-100">
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* ======================================================
           ✅ SADELEŞTİRİLMİŞ HERO (MOBİLDE GİZLİ)
        ====================================================== */}
        <section className="hidden lg:block bg-white rounded-2xl shadow p-8">
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-3">
              <h1 className="text-3xl font-bold leading-tight">
                Türkiye’de ikinci el saat{" "}
                <span className="text-green-700">al</span> &{" "}
                <span className="text-green-700">sat</span>
              </h1>
              <p className="text-gray-600 max-w-2xl">
                Marka/model keşfet, ilanları filtrele, satıcıyla hızlı iletişime geç.
              </p>

              <div className="flex items-center gap-3 mt-4">
                <Link
                  href="/new"
                  className="bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-xl"
                >
                  İlan Ver
                </Link>
              </div>
            </div>

            <div className="border rounded-2xl p-4 bg-gray-50 min-w-[320px]">
              <div className="text-sm font-semibold">Hızlı arama</div>
              <div className="text-xs text-gray-600 mt-1">
                En son ilanlar içinde anında filtreler.
              </div>

              <div className="mt-3 flex gap-2">
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Rolex, Seiko, otomatik..."
                  className="flex-1 border rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-200"
                />
                <button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById("latest-listings");
                    if (el)
                      el.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className="bg-gray-900 hover:bg-black text-white px-4 py-2 rounded-xl text-sm font-semibold"
                >
                  Git
                </button>
              </div>

              <div className="mt-3 text-xs text-gray-500">
                Not: Filtreler “Son ilanlar” bölümünde.
              </div>
            </div>
          </div>
        </section>

        {/* ======================================================
           ✅ SON İLANLAR
        ====================================================== */}
        <section
          id="latest-listings"
          className="bg-white rounded-2xl shadow p-6 sm:p-8"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold">Son ilanlar</h2>
              <div className="text-sm text-gray-600 mt-1">
                Filtrele · Sırala · Hızlı keşfet
              </div>
            </div>

            <Link
              href="/new"
              className="bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2 rounded-xl text-sm"
            >
              + İlan Ver
            </Link>
          </div>

          {/* Quick Discovery */}
          <div className="mt-5">
            <div className="text-sm font-semibold mb-2">Hızlı keşif</div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="px-3 py-2 rounded-full border hover:bg-gray-50 text-sm"
                onClick={() => applyPreset("auto")}
              >
                Otomatik
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-full border hover:bg-gray-50 text-sm"
                onClick={() => applyPreset("quartz")}
              >
                Quartz
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-full border hover:bg-gray-50 text-sm"
                onClick={() => applyPreset("unisex")}
              >
                Unisex
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-full border hover:bg-gray-50 text-sm"
                onClick={() => applyPreset("fullset")}
              >
                Full set
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-full border hover:bg-gray-50 text-sm"
                onClick={() => applyPreset("wear_none")}
              >
                Aşınma yok
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-full border hover:bg-gray-50 text-sm"
                onClick={() => applyPreset("wear_light")}
              >
                Hafif aşınma
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-full border hover:bg-gray-50 text-sm"
                onClick={() => applyPreset("cheap")}
              >
                Uygun fiyat
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-full border hover:bg-gray-50 text-sm"
                onClick={() => applyPreset("luxury")}
              >
                100K+
              </button>

              <button
                type="button"
                className="px-3 py-2 rounded-full border hover:bg-gray-50 text-sm ml-auto"
                onClick={() => resetFilters()}
              >
                Filtreleri sıfırla
              </button>
            </div>
          </div>

          {/* Filter Panel */}
          <div className="mt-5 border rounded-2xl p-4 bg-gray-50">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">
                Filtreler{" "}
                <span className="text-xs text-gray-500 font-normal">
                  ({totalFound} sonuç)
                </span>
              </div>

              <button
                type="button"
                onClick={() => setFiltersOpen((s) => !s)}
                className="sm:hidden text-sm underline text-gray-700"
              >
                {filtersOpen ? "Kapat" : "Aç"}
              </button>
            </div>

            <div className={`${filtersOpen ? "block" : "hidden"} sm:block mt-4`}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                {/* Search */}
                <div className="lg:col-span-2">
                  <div className="text-xs text-gray-600 mb-1">Arama</div>
                  <input
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder="Marka, model, başlık..."
                    className="w-full border rounded-xl px-4 py-2"
                  />
                </div>

                {/* Movement */}
                <div>
                  <div className="text-xs text-gray-600 mb-1">Çalışma</div>
                  <select
                    value={movementFilter}
                    onChange={(e) =>
                      setMovementFilter(
                        pickEnum(e.target.value, MOVEMENT_OPTIONS, "") as any
                      )
                    }
                    className="w-full border rounded-xl px-3 py-2"
                  >
                    <option value="">Hepsi</option>
                    <option value="Otomatik">Otomatik</option>
                    <option value="Quartz">Quartz</option>
                    <option value="Manual">Manual</option>
                    <option value="Diğer">Diğer</option>
                  </select>
                </div>

                {/* Gender */}
                <div>
                  <div className="text-xs text-gray-600 mb-1">Cinsiyet</div>
                  <select
                    value={genderFilter}
                    onChange={(e) =>
                      setGenderFilter(
                        pickEnum(e.target.value, GENDER_OPTIONS, "") as any
                      )
                    }
                    className="w-full border rounded-xl px-3 py-2"
                  >
                    <option value="">Hepsi</option>
                    <option value="Erkek">Erkek</option>
                    <option value="Kadın">Kadın</option>
                    <option value="Unisex">Unisex</option>
                    <option value="Diğer">Diğer</option>
                  </select>
                </div>

                {/* Accessories */}
                <div>
                  <div className="text-xs text-gray-600 mb-1">Aksesuar</div>
                  <select
                    value={accessoriesFilter}
                    onChange={(e) =>
                      setAccessoriesFilter(
                        pickEnum(e.target.value, ACCESSORY_OPTIONS, "") as any
                      )
                    }
                    className="w-full border rounded-xl px-3 py-2"
                  >
                    <option value="">Hepsi</option>
                    <option value="both">Kutu + Belge</option>
                    <option value="box">Sadece kutu</option>
                    <option value="papers">Sadece belge</option>
                    <option value="none">Yok</option>
                  </select>
                </div>

                {/* Wear */}
                <div>
                  <div className="text-xs text-gray-600 mb-1">Aşınma</div>
                  <select
                    value={wearFilter}
                    onChange={(e) =>
                      setWearFilter(
                        pickEnum(e.target.value, WEAR_OPTIONS, "") as any
                      )
                    }
                    className="w-full border rounded-xl px-3 py-2"
                  >
                    <option value="">Hepsi</option>
                    <option value="none">Aşınma yok</option>
                    <option value="light">Hafif</option>
                    <option value="medium">Orta</option>
                    <option value="heavy">Belirgin</option>
                  </select>
                </div>

                {/* Price min/max + sort */}
                <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <div className="text-xs text-gray-600 mb-1">Min fiyat</div>
                    <input
                      type="number"
                      value={priceMin}
                      onChange={(e) => setPriceMin(e.target.value)}
                      className="w-full border rounded-xl px-4 py-2"
                      placeholder="0"
                      min={0}
                    />
                  </div>

                  <div>
                    <div className="text-xs text-gray-600 mb-1">Max fiyat</div>
                    <input
                      type="number"
                      value={priceMax}
                      onChange={(e) => setPriceMax(e.target.value)}
                      className="w-full border rounded-xl px-4 py-2"
                      placeholder="örn 50000"
                      min={0}
                    />
                  </div>

                  <div>
                    <div className="text-xs text-gray-600 mb-1">Sırala</div>
                    <select
                      value={sortBy}
                      onChange={(e) =>
                        setSortBy(pickEnum(e.target.value, SORT_OPTIONS, "newest"))
                      }
                      className="w-full border rounded-xl px-3 py-2"
                    >
                      <option value="newest">En yeni</option>
                      <option value="price_asc">Fiyat (artan)</option>
                      <option value="price_desc">Fiyat (azalan)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="text-xs text-gray-500">
                  ✅ Filtreler URL’e yazılır → paylaşılabilir link olur.
                </div>

                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-sm underline text-gray-700"
                >
                  Tüm filtreleri sıfırla
                </button>
              </div>
            </div>
          </div>

          {/* Grid */}
          {gridListings.length === 0 ? (
            <div className="mt-8 border rounded-2xl p-6 text-center bg-gray-50">
              <div className="font-semibold text-gray-900">
                Bu filtrelerle ilan bulunamadı.
              </div>
              <div className="text-sm text-gray-600 mt-1">
                Filtreleri gevşetebilir veya sıfırlayabilirsin.
              </div>

              <button
                type="button"
                onClick={() => resetFilters()}
                className="mt-4 bg-gray-900 hover:bg-black text-white font-semibold px-5 py-3 rounded-xl"
              >
                Filtreleri sıfırla
              </button>
            </div>
          ) : (
            <>
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {gridListings.map((l) => {
                  const thumb = firstImage(l.imageUrls);
                  const brand = safeText(l.brandName, "");
                  const model = safeText(l.modelName, "");
                  const ago = timeAgoTR(l.createdAt);

                  const wearLabel =
                    normalizeText(l.wearLevel || "") ||
                    (l.wearExists ? "Orta aşınma" : "Aşınma yok");

                  const accValue = accessoriesValueFromLabel(l.accessories);
                  const accBadge =
                    accValue === "both"
                      ? "Full set"
                      : accValue === "box"
                      ? "Kutulu"
                      : accValue === "papers"
                      ? "Belgeli"
                      : accValue === "none"
                      ? "Aksesuar yok"
                      : "";

                  const move = normalizeText(l.movementType || "");

                  return (
                    <Link key={l.id} href={`/ilan/${l.id}`} className="block">
                      <div className="border rounded-2xl overflow-hidden bg-white hover:shadow-md transition">
                        {thumb ? (
                          <img
                            src={thumb}
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

                          <div className="text-sm text-green-700 font-semibold">
                            {formatPriceTRY(l.price)}
                          </div>

                          {(brand || model) && (
                            <div className="text-xs text-gray-500">
                              {brand}
                              {model ? ` / ${model}` : ""}
                            </div>
                          )}

                          <div className="flex flex-wrap gap-2 pt-1">
                            {move && (
                              <span className="text-[11px] px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                                {move}
                              </span>
                            )}

                            {wearLabel && (
                              <span className="text-[11px] px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                                {wearLabel}
                              </span>
                            )}

                            {accBadge && (
                              <span className="text-[11px] px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                                {accBadge}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center justify-between text-xs text-gray-400 pt-1">
                            <div className="truncate">
                              {l.gender ? safeText(l.gender, "") : ""}
                            </div>
                            <div className="shrink-0">{ago}</div>
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>

              <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="text-sm text-gray-600">
                  Gösterilen:{" "}
                  <span className="font-semibold">{gridListings.length}</span> /{" "}
                  <span className="font-semibold">{totalFound}</span> sonuç
                  {hasMoreListings ? (
                    <span className="ml-2 text-xs text-gray-400">
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
                      className={`px-5 py-3 rounded-xl font-semibold text-white ${
                        loadingMoreListings
                          ? "bg-gray-400 cursor-not-allowed"
                          : "bg-gray-900 hover:bg-black"
                      }`}
                    >
                      {loadingMoreListings ? "Yükleniyor..." : "Daha fazla göster"}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                    className="text-sm underline text-gray-700"
                  >
                    Yukarı çık
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        {/* =======================
            TREND BRANDS
        ======================= */}
        <section className="bg-white rounded-2xl shadow p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-bold">Öne çıkan markalar</h2>
            <div className="text-xs text-gray-500">Trend</div>
          </div>

          {topBrands.length === 0 ? (
            <div className="text-gray-600 mt-4">Henüz yeterli ilan yok.</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mt-4">
              {topBrands.map((b) => (
                <Link
                  key={b.brandId}
                  href={`/${b.slug}`}
                  className="border rounded-xl px-4 py-3 hover:bg-gray-50 transition flex items-center justify-between gap-2"
                >
                  <div className="font-semibold truncate">{b.name}</div>
                  <div className="text-xs text-gray-500 shrink-0">{b.count}</div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* =======================
            TREND MODELS
        ======================= */}
        <section className="bg-white rounded-2xl shadow p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-bold">Öne çıkan modeller</h2>
            <div className="text-xs text-gray-500">Trend</div>
          </div>

          {topModels.length === 0 ? (
            <div className="text-gray-600 mt-4">Henüz yeterli ilan yok.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
              {topModels.map((m) => (
                <Link
                  key={m.modelId}
                  href={m.href}
                  className="border rounded-xl px-4 py-3 hover:bg-gray-50 transition"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{m.name}</div>
                      <div className="text-xs text-gray-500 truncate">
                        {m.brandName}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 shrink-0">{m.count}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* =======================
            FOOTER CTA
        ======================= */}
        <section className="bg-gradient-to-r from-green-700 to-green-600 rounded-2xl shadow p-8 text-white">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="text-2xl font-bold">Saatini satmaya hazır mısın?</div>
              <div className="text-sm text-green-50 mt-1">
                Profilini tamamla, ilanını yayınla, alıcılar sana ulaşsın.
              </div>
            </div>

            <div className="flex gap-3">
              <Link
                href="/new"
                className="bg-white text-green-700 font-semibold px-6 py-3 rounded-xl"
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
                className="border border-white/70 hover:bg-white/10 font-semibold px-6 py-3 rounded-xl"
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
