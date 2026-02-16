// app/ilan/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { devError, devWarn, getFriendlyErrorMessage } from "@/lib/logger";
import { buildListingPath, extractListingId } from "@/lib/listingUrl";

/* ================= TYPES ================= */

type Listing = {
  title: string;
  price: number;

  categoryId: string;
  categoryName: string;
  subCategoryId: string;
  subCategoryName: string;

  // ✅ yeni sistem alanları
  conditionKey?: "new" | "likeNew" | "good" | "used" | "forParts" | "";
  conditionLabel?: string;
  schemaVersion?: number | null;
  attributes?: Record<string, any>;
  status?: "active" | "draft" | "sold";

  // legacy/opsiyonel
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

  imageUrls?: string[];

  ownerId: string;
  createdAt?: any;
  updatedAt?: any;
};

type PublicProfile = {
  name?: string;
  displayName?: string;

  bio?: string;

  websiteInstagram?: string;
  avatarUrl?: string;
  phone?: string;
  email?: string;
  address?: string;
};

type ListingDetailClientProps = {
  initialListing?: Listing | null;
  initialSeller?: PublicProfile | null;
};

type SchemaField = {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "boolean" | "multiselect";
  required: boolean;
  placeholder?: string;
  min?: number | null;
  max?: number | null;
  options?: string[];
};

type ListingSchemaDoc = {
  categoryId: string;
  version: number;
  fields: SchemaField[];
};

type SimilarListing = {
  id: string;
  title: string;
  price: number;
  imageUrls?: string[];
  categoryName?: string;
  subCategoryName?: string;
};

type SellerOtherListing = {
  id: string;
  title: string;
  price: number;
  imageUrls?: string[];
  categoryName?: string;
  subCategoryName?: string;
};

/* ================= HELPERS ================= */

const fmtTL = (v: number) => {
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${v} TL`;
  }
};

const BOARD_GAME_ATTR_KEYS = new Set([
  "gameName",
  "minPlayers",
  "maxPlayers",
  "minPlaytime",
  "maxPlaytime",
  "suggestedAge",
  "language",
  "completeContent",
  "sleeved",
]);

const formatDateTR = (value: any) => {
  if (!value) return "";
  const asDate = value?.toDate ? value.toDate() : new Date(value);
  if (!(asDate instanceof Date) || Number.isNaN(asDate.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(asDate);
  } catch {
    return "";
  }
};


const safeText = (v: any) => {
  if (v === null || v === undefined) return "";
  return String(v);
};

const onlyDigits = (s: string) => (s || "").replace(/\D/g, "");

const buildWhatsAppLink = (rawPhone: string) => {
  const digits = onlyDigits(rawPhone);
  if (!digits) return "";

  let normalized = digits;

  if (normalized.startsWith("0") && normalized.length >= 10) {
    normalized = normalized.slice(1);
  }

  if (normalized.startsWith("90")) {
    // ok
  } else if (normalized.startsWith("5") && normalized.length >= 10) {
    normalized = `90${normalized}`;
  } else if (normalized.length === 10 && normalized.startsWith("5")) {
    normalized = `90${normalized}`;
  }

  return `https://wa.me/${normalized}`;
};

const normalizeWebsiteInstagramLink = (value: string) => {
  const v = (value || "").trim();
  if (!v) return "";

  if (v.startsWith("@")) {
    return `https://instagram.com/${v.replace("@", "").trim()}`;
  }

  const looksLikeUsername =
    !v.includes(" ") &&
    !v.includes("/") &&
    !v.includes("http") &&
    !v.includes(".") &&
    v.length >= 2;

  if (looksLikeUsername) {
    return `https://instagram.com/${v}`;
  }

  if (!/^https?:\/\//i.test(v)) {
    return `https://${v}`;
  }

  return v;
};

const accessoryLabel = (v: string) => {
  if (v === "both") return "Orijinal kutu ve orijinal belgeler";
  if (v === "box") return "Orijinal kutu";
  if (v === "papers") return "Orijinal belgeler";
  if (v === "none") return "Başka aksesuar yok";
  return v;
};

function slugifyTR(input: string) {
  return (input || "")
    .toLocaleLowerCase("tr-TR")
    .trim()
    .replaceAll("ı", "i")
    .replaceAll("ş", "s")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replaceAll("İ", "i")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatAttrValue(v: any) {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Evet" : "Hayır";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

/* ================= PAGE ================= */

export default function ListingDetailClient({
  initialListing = null,
  initialSeller = null,
}: ListingDetailClientProps) {
  const params = useParams<{ id: string }>();
  const rawId = params?.id || "";
  const listingId = extractListingId(rawId);

  const router = useRouter();

  const [listing, setListing] = useState<Listing | null>(initialListing);
  const [seller, setSeller] = useState<PublicProfile | null>(initialSeller);
  const [similarListings, setSimilarListings] = useState<SimilarListing[]>([]);
  const [sellerOtherListings, setSellerOtherListings] = useState<SellerOtherListing[]>([]);

  const [loading, setLoading] = useState(!initialListing);
  const [mainImage, setMainImage] = useState<string | null>(
    initialListing?.imageUrls?.[0] || null
  );

  const [error, setError] = useState<string>("");

  // Schema (attributes label göstermek için)
  const [schemaFields, setSchemaFields] = useState<SchemaField[]>([]);

  // Auth state
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // CTA states
  const [msgCreating, setMsgCreating] = useState(false);
  const [msgError, setMsgError] = useState<string>("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        setCurrentUserId(null);
        return;
      }
      setCurrentUserId(u.uid);
    });
    return () => unsub();
  }, []);

  /* ================= LOAD LISTING ================= */

  useEffect(() => {
    if (!listingId) return;

    let cancelled = false;

    async function loadAll() {
      if (!initialListing) setLoading(true);
      setError("");

      try {
        const listingRef = doc(db, "listings", listingId);
        const listingSnap = await getDoc(listingRef);

        if (!listingSnap.exists()) {
          if (!cancelled) {
            setListing(null);
            setSeller(null);
            setSchemaFields([]);
          }
          return;
        }

        const listingData = listingSnap.data() as Listing;

        if (cancelled) return;

        setListing(listingData);
        setMainImage(listingData.imageUrls?.[0] || null);

        // SELLER PROFILE
        if (listingData.ownerId) {
          const profileSnap = await getDoc(doc(db, "publicProfiles", listingData.ownerId));
          if (!cancelled) {
            setSeller(profileSnap.exists() ? (profileSnap.data() as PublicProfile) : null);
          }
        } else {
          if (!cancelled) setSeller(null);
        }

        // LISTING SCHEMA (attributes label göstermek için)
        // schema docId = categoryId (bizde category = categoryId)
        if (listingData.categoryId) {
          try {
            const sSnap = await getDoc(doc(db, "listingSchemas", listingData.categoryId));
            if (!cancelled) {
              if (sSnap.exists()) {
                const d = sSnap.data() as ListingSchemaDoc;
                setSchemaFields(Array.isArray(d.fields) ? d.fields : []);
              } else {
                setSchemaFields([]);
              }
            }
          } catch {
            if (!cancelled) {
              setSchemaFields([]);
            }
          }
        } else {
          if (!cancelled) {
            setSchemaFields([]);
          }
        }

        if (!cancelled) {
          setSimilarListings([]);
          setSellerOtherListings([]);
        }

        const currentListingId = listingSnap.id;
        const toPreview = (snap: any) => {
          const data = snap.data() as Listing;
          return {
            id: snap.id,
            title: safeText(data.title) || "İlan",
            price: Number(data.price ?? 0),
            imageUrls: Array.isArray(data.imageUrls) ? data.imageUrls : [],
            categoryName: data.categoryName,
            subCategoryName: data.subCategoryName,
          };
        };

        const extraTasks: Array<Promise<void>> = [];

        if (listingData.ownerId) {
          extraTasks.push(
            (async () => {
              try {
                const sellerQuery = query(
                  collection(db, "listings"),
                  where("ownerId", "==", listingData.ownerId),
                  orderBy("createdAt", "desc"),
                  limit(9)
                );
                const sellerSnap = await getDocs(sellerQuery);
                if (cancelled) return;
                const items = sellerSnap.docs
                  .filter((d) => d.id !== currentListingId)
                  .map(toPreview)
                  .slice(0, 8);
                setSellerOtherListings(items);
              } catch (e) {
                devWarn("Seller listings load failed", e);
              }
            })()
          );
        }

        if (listingData.subCategoryId) {
          extraTasks.push(
            (async () => {
              try {
                const similarQuery = query(
                  collection(db, "listings"),
                  where("subCategoryId", "==", listingData.subCategoryId),
                  orderBy("createdAt", "desc"),
                  limit(9)
                );
                const similarSnap = await getDocs(similarQuery);
                if (cancelled) return;
                const items = similarSnap.docs
                  .filter((d) => d.id !== currentListingId)
                  .map(toPreview)
                  .slice(0, 8);
                setSimilarListings(items);
              } catch (e) {
                devWarn("Similar listings load failed", e);
              }
            })()
          );
        }

        if (extraTasks.length > 0) {
          await Promise.all(extraTasks);
        }

      } catch (e: any) {
        devError("ListingDetailPage load error", e);
        if (!cancelled)
          setError(
            getFriendlyErrorMessage(e, "İlan yüklenemedi. Lütfen tekrar dene.")
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAll();

    return () => {
      cancelled = true;
    };
  }, [listingId]);

  /* ================= COMPUTED ================= */

  const sellerDisplayName = useMemo(() => {
    const dn = safeText(seller?.displayName).trim();
    const n = safeText(seller?.name).trim();
    return dn || n || "Satıcı";
  }, [seller?.displayName, seller?.name]);

  const waLink = useMemo(() => {
    const phone = seller?.phone || "";
    if (!phone) return "";
    return buildWhatsAppLink(phone);
  }, [seller?.phone]);

  const websiteInstagramLink = useMemo(() => {
    if (!seller?.websiteInstagram) return "";
    return normalizeWebsiteInstagramLink(seller.websiteInstagram);
  }, [seller?.websiteInstagram]);

  const hasImages = !!listing?.imageUrls && listing.imageUrls.length > 0;

  const breadcrumbCategoryHref = useMemo(() => {
    if (!listing?.categoryName) return "";
    return `/${slugifyTR(listing.categoryName)}`;
  }, [listing?.categoryName]);

  const breadcrumbSubCategoryHref = useMemo(() => {
    if (!listing?.categoryName || !listing?.subCategoryName) return "";
    const categorySlug = slugifyTR(listing.categoryName);
    const subCategorySlug = slugifyTR(listing.subCategoryName);
    return `/${categorySlug}/${subCategorySlug}`;
  }, [listing?.categoryName, listing?.subCategoryName]);

  const canMessageSeller = useMemo(() => {
    if (!listing) return false;
    if (!currentUserId) return false;
    if (!listing.ownerId) return false;
    return currentUserId !== listing.ownerId;
  }, [listing, currentUserId]);

  const isBoardGameCategory = useMemo(() => {
    const categoryId = safeText(listing?.categoryId || "");
    return categoryId.startsWith("kutu-oyunlari");
  }, [listing?.categoryId]);

  // ✅ attributes render listesi (schema varsa label ile)
  const attributeRows = useMemo(() => {
    const attrs = listing?.attributes && typeof listing.attributes === "object" ? listing.attributes : {};
    const keys = Object.keys(attrs || {});

    if (keys.length === 0) return [];

    const fieldByKey = new Map<string, SchemaField>();
    for (const f of schemaFields) fieldByKey.set(f.key, f);

    return keys
      .filter((k) => !isBoardGameCategory || !BOARD_GAME_ATTR_KEYS.has(k))
      .map((k) => {
        const field = fieldByKey.get(k);
        const label = field?.label || k;
        const val = formatAttrValue((attrs as any)[k]);
        if (!val) return null;
        return { key: k, label, value: val };
      })
      .filter(Boolean) as Array<{ key: string; label: string; value: string }>;
  }, [listing?.attributes, schemaFields, isBoardGameCategory]);

  const boardGameDetails = useMemo(() => {
    const attrs = listing?.attributes && typeof listing.attributes === "object" ? listing.attributes : {};
    const buildRange = (minVal: any, maxVal: any, suffix?: string) => {
      const minOk = minVal !== null && minVal !== undefined && String(minVal).trim() !== "";
      const maxOk = maxVal !== null && maxVal !== undefined && String(maxVal).trim() !== "";
      if (minOk && maxOk) {
        return `${minVal} - ${maxVal}${suffix ? ` ${suffix}` : ""}`;
      }
      if (minOk) return `${minVal}${suffix ? ` ${suffix}` : ""}`;
      if (maxOk) return `${maxVal}${suffix ? ` ${suffix}` : ""}`;
      return "";
    };

    return {
      gameName: safeText((attrs as any).gameName).trim(),
      players: buildRange((attrs as any).minPlayers, (attrs as any).maxPlayers),
      playtime: buildRange((attrs as any).minPlaytime, (attrs as any).maxPlaytime, "dk"),
      suggestedAge: safeText((attrs as any).suggestedAge).trim(),
      language: safeText((attrs as any).language).trim(),
      completeContent: formatAttrValue((attrs as any).completeContent),
      sleeved: formatAttrValue((attrs as any).sleeved),
    };
  }, [listing?.attributes]);

  const boardGameAgeLabel = useMemo(() => {
    const age = safeText(boardGameDetails.suggestedAge).trim();
    if (!age) return "";
    return age.includes("+") ? age : `${age}+`;
  }, [boardGameDetails.suggestedAge]);

  const boardGameInfoTags = useMemo(() => {
    if (!isBoardGameCategory) return [] as string[];
    const tags: string[] = [];
    if (boardGameDetails.gameName) tags.push(`Oyun: ${boardGameDetails.gameName}`);
    if (boardGameDetails.players) tags.push(`Oyuncu: ${boardGameDetails.players}`);
    if (boardGameDetails.playtime) tags.push(`Süre: ${boardGameDetails.playtime}`);
    if (boardGameAgeLabel) tags.push(`Yaş: ${boardGameAgeLabel}`);
    return tags;
  }, [
    isBoardGameCategory,
    boardGameDetails.gameName,
    boardGameDetails.players,
    boardGameDetails.playtime,
    boardGameAgeLabel,
  ]);

  const publishedAt = useMemo(() => formatDateTR(listing?.createdAt), [listing?.createdAt]);


  const pageWrapClass =
    "min-h-screen bg-[#f7f4ef] bg-[radial-gradient(circle_at_top,_#fff7ed,_#f7f4ef_60%)]";
  const cardClass =
    "rounded-3xl border border-[#ead8c5] bg-white/85 shadow-[0_24px_60px_-45px_rgba(15,23,42,0.45)]";
  const sectionTitleClass = "text-lg font-semibold text-[#3f2a1a]";
  const subtleTextClass = "text-sm text-[#6b4b33]";
  const chipBaseClass =
    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wide";
  const listingCardClass =
    "group overflow-hidden rounded-2xl border border-[#ead8c5] bg-white/85 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.4)] transition hover:-translate-y-0.5 hover:shadow-[0_30px_50px_-30px_rgba(15,23,42,0.5)]";

  /* ================= MESSAGE CTA ================= */

  async function handleMessageSeller() {
    if (!listing || !listingId) return;

    setMsgError("");

    const user = auth.currentUser;
    if (!user) {
      const back = buildListingPath(listingId, listing.title);
      router.push(`/login?next=${encodeURIComponent(back)}`);
      return;
    }

    if (user.uid === listing.ownerId) {
      setMsgError("Kendi ilanına mesaj gönderemezsin.");
      return;
    }

    try {
      setMsgCreating(true);

      // ✅ Yeni davranış: direkt "new chat" sayfasına git
      // Bu sayfa conversation oluşturma / duplicate kontrol işini tek yerden yapacak
      router.push(
        `/my/messages/new?listingId=${encodeURIComponent(listingId)}&sellerId=${encodeURIComponent(listing.ownerId)}`
      );
    } catch (e: any) {
      devError("handleMessageSeller error", e);
      setMsgError(
        getFriendlyErrorMessage(e, "Mesaj başlatılamadı. Tekrar dene.")
      );
    } finally {
      setMsgCreating(false);
    }
  }

  /* ================= UI STATES ================= */

  if (loading) {
    return (
      <div className={`${pageWrapClass} px-4 py-12 flex items-center justify-center`}>
        <div className="w-full max-w-md rounded-3xl border border-[#ead8c5] bg-white/85 p-6 text-center shadow-[0_24px_60px_-45px_rgba(15,23,42,0.45)]">
          <div className="text-lg font-semibold text-[#3f2a1a]">Yükleniyor...</div>
          <div className="mt-2 text-sm text-[#6b4b33]">
            İlan bilgileri hazırlanıyor.
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${pageWrapClass} px-4 py-12 flex items-center justify-center`}>
        <div className="w-full max-w-md rounded-3xl border border-red-200 bg-red-50 p-6 text-center shadow-[0_24px_60px_-45px_rgba(15,23,42,0.45)]">
          <div className="text-red-700 font-semibold mb-2">Bir sorun oluştu</div>
          <div className="text-sm text-red-700">{error}</div>
          <button
            onClick={() => router.push("/")}
            className="mt-5 inline-flex items-center justify-center rounded-full border border-red-200 bg-white px-5 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 transition"
          >
            Ana sayfaya dön
          </button>
        </div>
      </div>
    );
  }

  if (!listing) {
    return (
      <div className={`${pageWrapClass} px-4 py-12 flex items-center justify-center`}>
        <div className="w-full max-w-md rounded-3xl border border-[#ead8c5] bg-white/85 p-6 text-center shadow-[0_24px_60px_-45px_rgba(15,23,42,0.45)]">
          <div className="text-lg font-semibold text-[#3f2a1a]">İlan bulunamadı</div>
          <div className="mt-2 text-sm text-[#6b4b33]">
            Aradığın ilan yayından kaldırılmış olabilir.
          </div>
          <button
            onClick={() => router.push("/")}
            className="mt-5 inline-flex items-center justify-center rounded-full border border-[#ead8c5] bg-white px-5 py-2 text-sm font-semibold text-[#3f2a1a] hover:bg-[#fff7ed] transition"
          >
            Ana sayfaya dön
          </button>
        </div>
      </div>
    );
  }

  /* ================= UI ================= */

  return (
    <div className={pageWrapClass}>
      <div className="max-w-[1440px] mx-auto px-3 sm:px-5 py-8 sm:py-10 space-y-8">
        {/* BREADCRUMB */}
        <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-[#7a634e]">
          <Link href="/" className="font-semibold text-[#6b4b33] hover:text-[#3f2a1a]">
            Ana Sayfa
          </Link>
          <span className="text-[#b79b84]">›</span>
          {breadcrumbCategoryHref ? (
            <Link href={breadcrumbCategoryHref} className="hover:text-[#3f2a1a]">
              {listing.categoryName}
            </Link>
          ) : (
            <span>{listing.categoryName}</span>
          )}
          <span className="text-[#b79b84]">›</span>
          {breadcrumbSubCategoryHref ? (
            <Link href={breadcrumbSubCategoryHref} className="hover:text-[#3f2a1a]">
              {listing.subCategoryName}
            </Link>
          ) : (
            <span>{listing.subCategoryName}</span>
          )}
          <span className="text-[#b79b84]">›</span>
          <span className="text-[#3f2a1a] line-clamp-1">{listing.title}</span>
        </div>

        <div className="grid grid-cols-1 gap-8">
          {/* LEFT */}
          <div className="space-y-6">
            {/* TITLE */}
            <div className={`${cardClass} p-6 sm:p-8`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-3">
                  <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#3f2a1a]">
                    {listing.title}
                  </h1>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`${chipBaseClass} border-[#ead8c5] bg-[#fff7ed] text-[#7a5a40]`}
                    >
                      {listing.categoryName} / {listing.subCategoryName}
                    </span>
                    {(listing.conditionLabel || listing.conditionKey) && (
                      <span
                        className={`${chipBaseClass} border-[#cfe4d7] bg-[#eff7f0] text-[#2f5b3a]`}
                      >
                        {listing.conditionLabel || listing.conditionKey}
                      </span>
                    )}
                    {publishedAt && (
                      <span
                        className={`${chipBaseClass} border-[#ead8c5] bg-white text-[#7a5a40]`}
                      >
                        Yayın tarihi: {publishedAt}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="rounded-2xl border border-[#ead8c5] bg-[#fff7ed] px-4 py-2 text-2xl sm:text-3xl font-semibold text-[#1f2a24]">
                    {fmtTL(Number(listing.price ?? 0))}
                  </div>
                </div>
              </div>
            </div>

            {/* MEDIA + DETAILS */}
            <div className={`${cardClass} p-6`}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className={sectionTitleClass}>Fotoğraflar</div>
                  <div className="relative rounded-2xl overflow-hidden bg-[#f3e9db] aspect-[4/3]">
                    {mainImage ? (
                      <Image
                        src={mainImage}
                        alt={listing.title || "İlan görseli"}
                        fill
                        sizes="(max-width: 1024px) 92vw, 50vw"
                        className="object-cover"
                        quality={70}
                        priority
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#9b7b5a]">
                        Görsel yok
                      </div>
                    )}
                  </div>

                  {hasImages && (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                      {listing.imageUrls!.map((url, i) => (
                        <button
                          key={`${url}-${i}`}
                          type="button"
                          onClick={() => setMainImage(url)}
                          className={`rounded-2xl overflow-hidden border transition ${
                            mainImage === url
                              ? "border-[#1f2a24] ring-1 ring-[#1f2a24]"
                              : "border-[#ead8c5] hover:border-[#c7b199]"
                          } relative`}
                          title="Görseli büyüt"
                        >
                          <Image
                            src={url}
                            alt={`thumb-${i}`}
                            fill
                            sizes="(max-width: 640px) 22vw, (max-width: 1024px) 18vw, 96px"
                            className="object-cover"
                            quality={45}
                          />
                        </button>
                      ))}
                    </div>
                  )}

                  {boardGameInfoTags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {boardGameInfoTags.map((tag) => (
                        <span
                          key={tag}
                          className={`${chipBaseClass} border-[#ead8c5] bg-[#fff7ed] text-[#6b4b33]`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-6">
                  <div className="space-y-4">
                    <div className={sectionTitleClass}>İlan Detayları</div>
                    {isBoardGameCategory ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="rounded-2xl border border-[#ead8c5] bg-white/80 px-4 py-3 md:col-span-2">
                          <div className="text-xs text-[#8a6a4f]">İlan başlığı</div>
                          <div className="text-sm font-semibold text-[#3f2a1a]">
                            {listing.title}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-[#ead8c5] bg-white/80 px-4 py-3">
                          <div className="text-xs text-[#8a6a4f]">Fiyat (TL)</div>
                          <div className="text-sm font-semibold text-[#3f2a1a]">
                            {fmtTL(Number(listing.price ?? 0))}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-[#ead8c5] bg-white/80 px-4 py-3">
                          <div className="text-xs text-[#8a6a4f]">Durum</div>
                          <div className="text-sm font-semibold text-[#3f2a1a]">
                            {listing.conditionLabel || listing.conditionKey || "Belirtilmemiş"}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-[#ead8c5] bg-white/80 px-4 py-3">
                          <div className="text-xs text-[#8a6a4f]">Dil</div>
                          <div className="text-sm font-semibold text-[#3f2a1a]">
                            {boardGameDetails.language || "Belirtilmemiş"}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-[#ead8c5] bg-white/80 px-4 py-3">
                          <div className="text-xs text-[#8a6a4f]">İçerik tam mı?</div>
                          <div className="text-sm font-semibold text-[#3f2a1a]">
                            {boardGameDetails.completeContent || "Belirtilmemiş"}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-[#ead8c5] bg-white/80 px-4 py-3 md:col-span-2">
                          <div className="text-xs text-[#8a6a4f]">Sleeve kullanıldı mı?</div>
                          <div className="text-sm font-semibold text-[#3f2a1a]">
                            {boardGameDetails.sleeved || "Belirtilmemiş"}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-[#ead8c5] bg-white/80 px-4 py-3 md:col-span-2">
                          <div className="text-xs text-[#8a6a4f]">Açıklama</div>
                          <div className="text-sm text-[#5a4330] whitespace-pre-line">
                            {listing.description || "Satıcı açıklama eklememiş."}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="space-y-3 text-sm text-[#5a4330]">
                          {(listing.conditionLabel || listing.conditionKey) ? (
                            <div>
                              <span className="font-semibold">Ürün durumu:</span>{" "}
                              {listing.conditionLabel || listing.conditionKey}
                            </div>
                          ) : (
                            <div className="text-[#9b7b5a]">Ürün durumu belirtilmemiş.</div>
                          )}

                          <div className="pt-3 border-t border-[#ead8c5]">
                            {listing.description ? (
                              <p className="whitespace-pre-line">{listing.description}</p>
                            ) : (
                              <div className="text-[#9b7b5a]">Satıcı açıklama eklememiş.</div>
                            )}
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className={sectionTitleClass}>Kategoriye Özel Bilgiler</div>
                          {attributeRows.length === 0 ? (
                            <div className={subtleTextClass}>
                              Bu ilan için özel alan eklenmemiş.
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {attributeRows.map((r) => (
                                <div
                                  key={r.key}
                                  className="rounded-2xl border border-[#ead8c5] bg-white/80 px-4 py-3"
                                >
                                  <div className="text-xs text-[#8a6a4f]">{r.label}</div>
                                  <div className="text-sm font-semibold text-[#3f2a1a]">
                                    {r.value}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* SELLER CARD */}
          <div className={`${cardClass} p-5`}>
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.3fr_1fr] gap-5 items-start">
              <div className="space-y-3 order-2 lg:order-1">
                <div className="flex flex-col gap-2">
                  {canMessageSeller ? (
                    <button
                      onClick={handleMessageSeller}
                      disabled={msgCreating}
                      className={`w-full font-semibold py-2.5 rounded-2xl text-center transition ${
                        msgCreating
                          ? "bg-[#b9c9bf] text-white cursor-not-allowed"
                          : "bg-[#1f2a24] hover:bg-[#2b3b32] text-white"
                      }`}
                    >
                      {msgCreating ? "Açılıyor..." : "Siteden mesaj gönder"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleMessageSeller}
                      className="w-full border border-[#ead8c5] bg-white hover:bg-[#fff7ed] text-[#3f2a1a] font-semibold py-2.5 rounded-2xl text-center"
                    >
                      {currentUserId ? "Bu ilan senin" : "Mesaj için giriş yap"}
                    </button>
                  )}

                  {msgError && (
                    <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-2xl p-3">
                      {msgError}
                    </div>
                  )}

                  {currentUserId && seller?.phone && waLink && (
                    <a
                      href={waLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 rounded-2xl text-center"
                    >
                      WhatsApp ile yaz
                    </a>
                  )}

                  {currentUserId && seller?.email && (
                    <a
                      href={`mailto:${seller.email}`}
                      className="w-full border border-[#ead8c5] hover:bg-[#fff7ed] text-[#3f2a1a] font-semibold py-2.5 rounded-2xl text-center"
                    >
                      E-posta gönder
                    </a>
                  )}

                  {seller?.websiteInstagram && (
                    <a
                      href={websiteInstagramLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full border border-[#ead8c5] hover:bg-[#fff7ed] text-[#3f2a1a] font-semibold py-2.5 rounded-2xl text-center"
                    >
                      Website / Instagram
                    </a>
                  )}

                  <button
                    onClick={() => router.push(`/seller/${listing.ownerId}`)}
                    className="w-full border border-[#ead8c5] hover:bg-[#fff7ed] text-[#3f2a1a] font-semibold py-2.5 rounded-2xl text-center"
                  >
                    Satıcı profili →
                  </button>
                </div>
              </div>

              <div className="space-y-3 order-1 lg:order-2 lg:justify-self-center">
                <div className="flex items-center gap-4">
                  {seller?.avatarUrl ? (
                    <img
                      src={seller.avatarUrl}
                      alt="avatar"
                      className="w-12 h-12 rounded-full object-cover border border-[#ead8c5]"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-[#fff7ed] border border-[#ead8c5] flex items-center justify-center text-[#9b7b5a] text-sm">
                      —
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="font-semibold text-base text-[#3f2a1a]">
                      {sellerDisplayName}
                    </div>
                    {seller?.bio ? (
                      <div className="text-xs text-[#6b4b33] line-clamp-2">
                        {seller.bio}
                      </div>
                    ) : (
                      <div className="text-xs text-[#9b7b5a]">
                        Satıcı hakkında açıklama yok.
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  {!currentUserId ? (
                    <div className="text-[#6b4b33] bg-[#fff7ed] border border-[#ead8c5] rounded-2xl p-3">
                      İletişim bilgilerini görmek için giriş yapmalısın.
                    </div>
                  ) : (
                    <>
                      {seller?.email ? (
                        <div className="text-[#5a4330]">
                          <span className="font-semibold">E-posta:</span>{" "}
                          <a href={`mailto:${seller.email}`} className="underline">
                            {seller.email}
                          </a>
                        </div>
                      ) : (
                        <div className="text-[#9b7b5a]">E-posta bilgisi yok.</div>
                      )}

                      {seller?.phone ? (
                        <div className="text-[#5a4330]">
                          <span className="font-semibold">Telefon:</span>{" "}
                          <span className="underline">{seller.phone}</span>
                        </div>
                      ) : (
                        <div className="text-[#9b7b5a]">Telefon bilgisi yok.</div>
                      )}

                      {seller?.address ? (
                        <div className="text-[#5a4330]">
                          <span className="font-semibold">Adres:</span>{" "}
                          <span className="whitespace-pre-line">{seller.address}</span>
                        </div>
                      ) : (
                        <div className="text-[#9b7b5a]">Adres bilgisi yok.</div>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-3 order-3">
                {seller?.address && (
                  <div className="overflow-hidden rounded-2xl border border-[#ead8c5] bg-white">
                    <iframe
                      title="Adres haritası"
                      src={`https://www.google.com/maps?q=${encodeURIComponent(
                        seller.address
                      )}&output=embed`}
                      className="w-full h-40"
                      loading="lazy"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

            <div className={`${cardClass} p-5 space-y-4`}>
              <div className="flex items-center justify-between gap-3">
                <div className={sectionTitleClass}>Bu kişinin diğer ilanları</div>
                <button
                  type="button"
                  onClick={() => router.push(`/seller/${listing.ownerId}`)}
                  className="text-xs font-semibold text-[#8a6a4f] hover:text-[#3f2a1a]"
                >
                  Tümünü gör
                </button>
              </div>

              {sellerOtherListings.length === 0 ? (
                <div className={subtleTextClass}>Henüz başka ilan yok.</div>
              ) : (
                <div className="space-y-3">
                  {sellerOtherListings.map((item) => (
                    <Link
                      key={item.id}
                      href={buildListingPath(item.id, item.title)}
                      className="flex items-center gap-3 rounded-2xl border border-[#ead8c5] bg-white/80 p-3 hover:bg-[#fff7ed] transition"
                    >
                      <div className="w-14 h-14 rounded-xl overflow-hidden bg-[#f3e9db] border border-[#ead8c5] flex-shrink-0">
                        {item.imageUrls?.[0] ? (
                          <Image
                            src={item.imageUrls[0]}
                            alt={item.title}
                            width={56}
                            height={56}
                            sizes="56px"
                            className="w-full h-full object-cover"
                            quality={45}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-[#9b7b5a]">
                            Görsel yok
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[#3f2a1a] line-clamp-2">
                          {item.title}
                        </div>
                        <div className="text-xs text-[#8a6a4f] line-clamp-1">
                          {item.categoryName || "Kategori"} / {item.subCategoryName || "Alt kategori"}
                        </div>
                        <div className="text-sm font-semibold text-[#1f2a24]">
                          {fmtTL(Number(item.price ?? 0))}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

          </div>

          </div>
      </div>
    </div>
  );
}
