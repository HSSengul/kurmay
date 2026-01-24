"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
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
import { startConversation } from "@/lib/chat";

/* ================= TYPES ================= */

type Listing = {
  title: string;
  price: number;

  brandId: string;
  brandName: string;
  modelId: string;
  modelName: string;

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

  phone?: string;
  email?: string;

  websiteInstagram?: string;
  avatarUrl?: string;

  address?: string;
};

type SimilarListing = {
  id: string;
  title: string;
  price: number;
  imageUrls?: string[];
  brandName?: string;
  modelName?: string;
};

type SellerOtherListing = {
  id: string;
  title: string;
  price: number;
  imageUrls?: string[];
  brandName?: string;
  modelName?: string;
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

const safeText = (v: any) => {
  if (v === null || v === undefined) return "";
  return String(v);
};

const onlyDigits = (s: string) => s.replace(/\D/g, "");

const buildWhatsAppLink = (rawPhone: string) => {
  const digits = onlyDigits(rawPhone);
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
  const v = value.trim();
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
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-ığüşöçİĞÜŞÖÇ]/gi, "")
    .replace(/-+/g, "-");
}

/* ================= PAGE ================= */

export default function ListingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const router = useRouter();

  const [listing, setListing] = useState<Listing | null>(null);
  const [seller, setSeller] = useState<PublicProfile | null>(null);

  const [similarListings, setSimilarListings] = useState<SimilarListing[]>([]);
  const [sellerOtherListings, setSellerOtherListings] = useState<SellerOtherListing[]>([]);

  const [loading, setLoading] = useState(true);
  const [mainImage, setMainImage] = useState<string | null>(null);

  const [error, setError] = useState<string>("");

  // Auth state
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserDisplayName, setCurrentUserDisplayName] = useState<string>("");

  // CTA states
  const [msgCreating, setMsgCreating] = useState(false);
  const [msgError, setMsgError] = useState<string>("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        setCurrentUserId(null);
        setCurrentUserDisplayName("");
        return;
      }
      setCurrentUserId(u.uid);
      setCurrentUserDisplayName(u.displayName || "");
    });
    return () => unsub();
  }, []);

  /* ================= LOAD LISTING ================= */

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    async function loadAll() {
      setLoading(true);
      setError("");

      try {
        const listingRef = doc(db, "listings", id);
        const listingSnap = await getDoc(listingRef);

        if (!listingSnap.exists()) {
          if (!cancelled) {
            setListing(null);
            setSeller(null);
            setSimilarListings([]);
            setSellerOtherListings([]);
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

        // SELLER OTHER LISTINGS
        if (listingData.ownerId) {
          const qSeller = query(
            collection(db, "listings"),
            where("ownerId", "==", listingData.ownerId),
            orderBy("createdAt", "desc"),
            limit(12)
          );

          const sellerSnap = await getDocs(qSeller);

          if (!cancelled) {
            const others = sellerSnap.docs
              .filter((d) => d.id !== id)
              .slice(0, 8)
              .map((d) => ({
                id: d.id,
                title: safeText(d.data().title),
                price: Number(d.data().price ?? 0),
                imageUrls: Array.isArray(d.data().imageUrls) ? (d.data().imageUrls as string[]) : [],
                brandName: safeText(d.data().brandName),
                modelName: safeText(d.data().modelName),
              }));

            setSellerOtherListings(others);
          }
        } else {
          if (!cancelled) setSellerOtherListings([]);
        }

        // SIMILAR LISTINGS
        if (listingData.modelId) {
          const qSimilar = query(
            collection(db, "listings"),
            where("modelId", "==", listingData.modelId),
            orderBy("createdAt", "desc"),
            limit(12)
          );

          const simSnap = await getDocs(qSimilar);

          if (!cancelled) {
            const sims = simSnap.docs
              .filter((d) => d.id !== id)
              .slice(0, 8)
              .map((d) => ({
                id: d.id,
                title: safeText(d.data().title),
                price: Number(d.data().price ?? 0),
                imageUrls: Array.isArray(d.data().imageUrls) ? (d.data().imageUrls as string[]) : [],
                brandName: safeText(d.data().brandName),
                modelName: safeText(d.data().modelName),
              }));

            setSimilarListings(sims);
          }
        } else {
          if (!cancelled) setSimilarListings([]);
        }
      } catch (e: any) {
        console.error("ListingDetailPage load error:", e);
        if (!cancelled) setError(e?.message || "Bir hata oluştu.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAll();

    return () => {
      cancelled = true;
    };
  }, [id]);

  /* ================= COMPUTED ================= */

  const sellerDisplayName = useMemo(() => {
    const dn = safeText(seller?.displayName).trim();
    const n = safeText(seller?.name).trim();
    return dn || n || "Satıcı";
  }, [seller?.displayName, seller?.name]);

  const waLink = useMemo(() => {
    if (!seller?.phone) return "";
    return buildWhatsAppLink(seller.phone);
  }, [seller?.phone]);

  const websiteInstagramLink = useMemo(() => {
    if (!seller?.websiteInstagram) return "";
    return normalizeWebsiteInstagramLink(seller.websiteInstagram);
  }, [seller?.websiteInstagram]);

  const hasImages = !!listing?.imageUrls && listing.imageUrls.length > 0;

  const breadcrumbBrandHref = useMemo(() => {
    if (!listing?.brandName) return "";
    return `/${slugifyTR(listing.brandName)}`;
  }, [listing?.brandName]);

  const breadcrumbModelHref = useMemo(() => {
    if (!listing?.brandName || !listing?.modelName) return "";
    const brandSlug = slugifyTR(listing.brandName);
    const modelSlug = slugifyTR(listing.modelName);
    return `/${brandSlug}/${modelSlug}`;
  }, [listing?.brandName, listing?.modelName]);

  /* ================= MESSAGE CTA ================= */

  const canMessageSeller = useMemo(() => {
    if (!listing) return false;
    if (!currentUserId) return false;
    if (!listing.ownerId) return false;
    return currentUserId !== listing.ownerId;
  }, [listing, currentUserId]);

  async function handleMessageSeller() {
    if (!listing || !id) return;

    setMsgError("");

    const user = auth.currentUser;
    if (!user) {
      const back = `/ilan/${id}`;
      router.push(`/login?next=${encodeURIComponent(back)}`);
      return;
    }

    if (user.uid === listing.ownerId) {
      setMsgError("Kendi ilanına mesaj gönderemezsin.");
      return;
    }

    try {
      setMsgCreating(true);

      const convoId = await startConversation({
        listing: {
          id: id,
          ownerId: listing.ownerId,
          title: listing.title,
          price: listing.price,
          brandName: listing.brandName,
          modelName: listing.modelName,
          imageUrls: listing.imageUrls || [],
        },
        buyer: {
          uid: user.uid,
          displayName: user.displayName || currentUserDisplayName || "User",
          avatarUrl: user.photoURL || "",
        },
        sellerProfile: {
          id: listing.ownerId,
          displayName: sellerDisplayName,
          avatarUrl: seller?.avatarUrl || "",
        },
      });

     router.push(`/my/messages/${convoId}`);
    } catch (e: any) {
      console.error("startConversation error:", e);
      setMsgError(e?.message || "Mesaj başlatılamadı. Tekrar dene.");
    } finally {
      setMsgCreating(false);
    }
  }

  /* ================= UI STATES ================= */

  if (loading) {
    return <div className="p-10 text-center text-gray-500">Yükleniyor...</div>;
  }

  if (error) {
    return (
      <div className="p-10 text-center">
        <div className="text-red-700 font-medium mb-4">{error}</div>
        <button onClick={() => router.push("/")} className="text-blue-600 underline">
          Ana sayfaya dön
        </button>
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="p-10 text-center">
        <p className="text-gray-500 mb-4">İlan bulunamadı.</p>
        <button onClick={() => router.push("/")} className="text-blue-600 underline">
          Ana sayfaya dön
        </button>
      </div>
    );
  }

  /* ================= UI ================= */

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-10">
      {/* BREADCRUMB */}
      <div className="text-sm text-gray-500 flex flex-wrap items-center gap-2">
        <Link href="/" className="underline hover:text-gray-800">
          Ana Sayfa
        </Link>

        <span>›</span>

        {breadcrumbBrandHref ? (
          <Link href={breadcrumbBrandHref} className="underline hover:text-gray-800">
            {listing.brandName}
          </Link>
        ) : (
          <span>{listing.brandName}</span>
        )}

        <span>›</span>

        {breadcrumbModelHref ? (
          <Link href={breadcrumbModelHref} className="underline hover:text-gray-800">
            {listing.modelName}
          </Link>
        ) : (
          <span>{listing.modelName}</span>
        )}

        <span>›</span>

        <span className="text-gray-700 line-clamp-1">{listing.title}</span>
      </div>

      {/* TOP: TITLE + GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-[66%_34%] gap-8">
        {/* LEFT */}
        <div className="space-y-8">
          {/* TITLE */}
          <div className="space-y-2">
            <h1 className="text-3xl font-bold leading-tight">{listing.title}</h1>

            <div className="flex flex-wrap items-center gap-3">
              <div className="text-2xl text-green-700 font-semibold">
                {fmtTL(Number(listing.price ?? 0))}
              </div>

              <div className="text-sm text-gray-600">
                {listing.brandName} / {listing.modelName}
              </div>
            </div>
          </div>

          {/* IMAGES */}
          <div className="border rounded-2xl bg-white overflow-hidden">
            <div className="p-5 border-b">
              <div className="font-semibold text-lg">Fotoğraflar</div>
              <div className="text-sm text-gray-500">
                {hasImages ? `${listing.imageUrls!.length} fotoğraf` : "Fotoğraf yok"}
              </div>
            </div>

            {hasImages ? (
              <div className="p-5 space-y-4">
                <div className="w-full">
                  {mainImage ? (
                    <img
                      src={mainImage}
                      alt="main"
                      className="w-full h-[460px] object-cover rounded-xl"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-[460px] rounded-xl bg-gray-100 flex items-center justify-center text-gray-400">
                      Görsel yok
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {listing.imageUrls!.map((url, i) => (
                    <button
                      key={`${url}-${i}`}
                      type="button"
                      onClick={() => setMainImage(url)}
                      className={`border rounded-xl overflow-hidden bg-white hover:shadow-sm transition ${
                        mainImage === url ? "border-gray-900" : "border-gray-200"
                      }`}
                      title="Görseli büyüt"
                    >
                      <img src={url} alt={`thumb-${i}`} className="w-full h-28 object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-6 text-gray-500">Bu ilanda fotoğraf yok.</div>
            )}
          </div>

          {/* DETAILS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* SAAT BİLGİLERİ */}
            <div className="border rounded-2xl bg-white p-5 space-y-3">
              <div className="font-semibold text-lg">Saat Bilgileri</div>

              <div className="space-y-2 text-sm text-gray-700">
                {listing.productionYear && (
                  <div>
                    <span className="font-medium">Üretim yılı:</span> {listing.productionYear}
                  </div>
                )}

                {listing.gender && (
                  <div>
                    <span className="font-medium">Cinsiyet:</span> {listing.gender}
                  </div>
                )}

                {listing.serialNumber && (
                  <div>
                    <span className="font-medium">Seri numarası:</span> {listing.serialNumber}
                  </div>
                )}

                {listing.movementType && (
                  <div>
                    <span className="font-medium">Çalışma şekli:</span> {listing.movementType}
                  </div>
                )}

                {!listing.productionYear && !listing.gender && !listing.serialNumber && !listing.movementType && (
                  <div className="text-gray-500">Bu bölümde bilgi belirtilmemiş.</div>
                )}
              </div>
            </div>

            {/* KASA & KADRAN */}
            <div className="border rounded-2xl bg-white p-5 space-y-3">
              <div className="font-semibold text-lg">Kasa & Kadran</div>

              <div className="space-y-2 text-sm text-gray-700">
                {listing.caseType && (
                  <div>
                    <span className="font-medium">Kasa tipi:</span> {listing.caseType}
                  </div>
                )}

                {listing.diameterMm !== null &&
                  listing.diameterMm !== undefined &&
                  safeText(listing.diameterMm) !== "" && (
                    <div>
                      <span className="font-medium">Çap:</span> {listing.diameterMm} mm
                    </div>
                  )}

                {listing.dialColor && (
                  <div>
                    <span className="font-medium">Kadran rengi:</span> {listing.dialColor}
                  </div>
                )}

                {!listing.caseType &&
                  (listing.diameterMm === null ||
                    listing.diameterMm === undefined ||
                    safeText(listing.diameterMm) === "") &&
                  !listing.dialColor && <div className="text-gray-500">Bu bölümde bilgi belirtilmemiş.</div>}
              </div>
            </div>

            {/* KORDON */}
            <div className="border rounded-2xl bg-white p-5 space-y-3">
              <div className="font-semibold text-lg">Kordon</div>

              <div className="space-y-2 text-sm text-gray-700">
                {listing.braceletMaterial && (
                  <div>
                    <span className="font-medium">Malzeme:</span> {listing.braceletMaterial}
                  </div>
                )}

                {listing.braceletColor && (
                  <div>
                    <span className="font-medium">Renk:</span> {listing.braceletColor}
                  </div>
                )}

                {!listing.braceletMaterial && !listing.braceletColor && (
                  <div className="text-gray-500">Bu bölümde bilgi belirtilmemiş.</div>
                )}
              </div>
            </div>

            {/* DURUM */}
            <div className="border rounded-2xl bg-white p-5 space-y-3">
              <div className="font-semibold text-lg">Durum</div>

              <div className="space-y-2 text-sm text-gray-700">
                <div>
                  <span className="font-medium">Aşınma:</span> {listing.wearExists ? "Mevcut" : "Belirtilmemiş / Yok"}
                </div>

                {listing.accessories && (
                  <div>
                    <span className="font-medium">Aksesuar:</span> {accessoryLabel(listing.accessories)}
                  </div>
                )}

                {!listing.accessories && <div className="text-gray-500">Aksesuar bilgisi belirtilmemiş.</div>}
              </div>
            </div>
          </div>

          {/* DESCRIPTION */}
          <div className="border rounded-2xl bg-white p-5 space-y-3">
            <div className="font-semibold text-lg">Açıklama</div>

            {listing.description ? (
              <p className="whitespace-pre-line text-sm text-gray-700">{listing.description}</p>
            ) : (
              <div className="text-sm text-gray-500">Satıcı açıklama eklememiş.</div>
            )}
          </div>

          {/* SELLER OTHER LISTINGS */}
          <div className="space-y-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="font-semibold text-lg">Satıcının Diğer İlanları</div>
                <div className="text-sm text-gray-500">
                  {sellerOtherListings.length > 0
                    ? `${sellerOtherListings.length} ilan gösteriliyor`
                    : "Gösterilecek ilan yok"}
                </div>
              </div>

              <button
                onClick={() => router.push(`/seller/${listing.ownerId}`)}
                className="text-sm underline text-gray-700 hover:text-gray-900"
              >
                Satıcı sayfasına git →
              </button>
            </div>

            {sellerOtherListings.length === 0 ? (
              <div className="text-gray-500">Bu satıcının başka ilanı yok.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {sellerOtherListings.map((l) => {
                  const thumb = l.imageUrls?.[0];

                  return (
                    <Link key={l.id} href={`/ilan/${l.id}`} className="block">
                      <div className="border rounded-2xl overflow-hidden bg-white hover:shadow-md transition">
                        {thumb ? (
                          <img src={thumb} alt="thumb" className="w-full h-40 object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-40 bg-gray-100 flex items-center justify-center text-gray-400 text-sm">
                            Görsel yok
                          </div>
                        )}

                        <div className="p-4 space-y-1">
                          <div className="font-semibold line-clamp-2">{l.title}</div>
                          <div className="text-sm text-green-700 font-medium">{fmtTL(Number(l.price ?? 0))}</div>

                          {(l.brandName || l.modelName) && (
                            <div className="text-xs text-gray-500">
                              {l.brandName || ""}
                              {l.modelName ? ` / ${l.modelName}` : ""}
                            </div>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* SIMILAR */}
          <div className="space-y-4">
            <div>
              <div className="font-semibold text-lg">Benzer İlanlar</div>
              <div className="text-sm text-gray-500">
                {similarListings.length > 0 ? `${similarListings.length} ilan gösteriliyor` : "Benzer ilan bulunamadı"}
              </div>
            </div>

            {similarListings.length === 0 ? (
              <div className="text-gray-500">Benzer ilan bulunamadı.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {similarListings.map((l) => {
                  const thumb = l.imageUrls?.[0];

                  return (
                    <Link key={l.id} href={`/ilan/${l.id}`} className="block">
                      <div className="border rounded-2xl overflow-hidden bg-white hover:shadow-md transition">
                        {thumb ? (
                          <img src={thumb} alt="thumb" className="w-full h-40 object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-40 bg-gray-100 flex items-center justify-center text-gray-400 text-sm">
                            Görsel yok
                          </div>
                        )}

                        <div className="p-4 space-y-1">
                          <div className="font-semibold line-clamp-2">{l.title}</div>
                          <div className="text-sm text-green-700 font-medium">{fmtTL(Number(l.price ?? 0))}</div>

                          {(l.brandName || l.modelName) && (
                            <div className="text-xs text-gray-500">
                              {l.brandName || ""}
                              {l.modelName ? ` / ${l.modelName}` : ""}
                            </div>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* DEBUG */}
          <div className="text-xs text-gray-400">İlan ID: {id}</div>
        </div>

        {/* RIGHT */}
        <div className="space-y-6 lg:sticky lg:top-6 h-fit">
          {/* SELLER CARD */}
          <div className="border rounded-2xl bg-white p-6 space-y-4">
            <div className="flex items-center gap-4">
              {seller?.avatarUrl ? (
                <img
                  src={seller.avatarUrl}
                  alt="avatar"
                  className="w-14 h-14 rounded-full object-cover border"
                  loading="lazy"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-gray-100 border flex items-center justify-center text-gray-400 text-sm">
                  —
                </div>
              )}

              <div className="min-w-0">
                <div className="font-semibold text-lg leading-tight">{sellerDisplayName}</div>
                {seller?.bio ? (
                  <div className="text-sm text-gray-600 line-clamp-2">{seller.bio}</div>
                ) : (
                  <div className="text-sm text-gray-400">Satıcı hakkında açıklama yok.</div>
                )}
              </div>
            </div>

            {/* CONTACT */}
            <div className="space-y-2 text-sm">
              {seller?.email ? (
                <div className="text-gray-700">
                  <span className="font-medium">E-posta:</span>{" "}
                  <a href={`mailto:${seller.email}`} className="underline">
                    {seller.email}
                  </a>
                </div>
              ) : (
                <div className="text-gray-500">E-posta bilgisi yok.</div>
              )}

              {seller?.phone ? (
                <div className="text-gray-700">
                  <span className="font-medium">Telefon:</span>{" "}
                  <span className="underline">{seller.phone}</span>
                </div>
              ) : (
                <div className="text-gray-500">Telefon bilgisi yok.</div>
              )}

              {seller?.address ? (
                <div className="text-gray-700">
                  <span className="font-medium">Adres:</span>{" "}
                  <span className="whitespace-pre-line">{seller.address}</span>
                </div>
              ) : (
                <div className="text-gray-500">Adres bilgisi yok.</div>
              )}
            </div>

            {/* MAP */}
            {seller?.address && (
              <iframe
                className="w-full h-44 rounded-xl border"
                loading="lazy"
                src={`https://www.google.com/maps?q=${encodeURIComponent(seller.address)}&output=embed`}
              />
            )}

            {/* ACTIONS */}
            <div className="flex flex-col gap-3 pt-2">
            {canMessageSeller ? (
                <button
                  onClick={handleMessageSeller}
                  disabled={msgCreating}
                  className={`w-full font-semibold py-3 rounded-xl text-center transition ${
                    msgCreating
                      ? "bg-blue-300 text-white cursor-not-allowed"
                      : "bg-blue-600 hover:bg-blue-700 text-white"
                  }`}
                >
                  {msgCreating ? "Sohbet açılıyor..." : "Siteden mesaj gönder"}
                </button>
              ) : (
                <div className="w-full border bg-gray-50 text-gray-500 font-semibold py-3 rounded-xl text-center">
                  {currentUserId ? "Bu ilan senin (mesaj gönderemezsin)" : "Mesaj için giriş yap"}
                </div>
              )}

            {msgError && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">
                  {msgError}
                </div>
              )}

              {seller?.phone && (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl text-center"
                >
                  WhatsApp ile yaz
                </a>
              )}

              {seller?.email && (
                <a
                  href={`mailto:${seller.email}`}
                  className="w-full border hover:bg-gray-50 font-semibold py-3 rounded-xl text-center"
                >
                  E-posta gönder
                </a>
              )}

              {seller?.websiteInstagram && (
                <a
                  href={websiteInstagramLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full border hover:bg-gray-50 font-semibold py-3 rounded-xl text-center"
                >
                  Website / Instagram
                </a>
              )}

              <button
                onClick={() => router.push(`/seller/${listing.ownerId}`)}
                className="w-full border hover:bg-gray-50 font-semibold py-3 rounded-xl text-center"
              >
                Satıcı profili ve tüm ilanları →
              </button>
            </div>
          </div>

          {/* QUICK INFO */}
          <div className="border rounded-2xl bg-white p-6 space-y-2">
            <div className="font-semibold">Hızlı Bilgi</div>
            <div className="text-sm text-gray-700">
              <span className="font-medium">Marka/Model:</span> {listing.brandName} / {listing.modelName}
            </div>

            {listing.productionYear && (
              <div className="text-sm text-gray-700">
                <span className="font-medium">Üretim:</span> {listing.productionYear}
              </div>
            )}

            {listing.diameterMm !== null &&
              listing.diameterMm !== undefined &&
              safeText(listing.diameterMm) !== "" && (
                <div className="text-sm text-gray-700">
                  <span className="font-medium">Çap:</span> {listing.diameterMm} mm
                </div>
              )}

            {listing.movementType && (
              <div className="text-sm text-gray-700">
                <span className="font-medium">Mekanizma:</span> {listing.movementType}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
