"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
  limit,
  startAfter,
  DocumentData,
  QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { devError, getFriendlyErrorMessage } from "@/lib/logger";
import { buildListingPath } from "@/lib/listingUrl";

/* =======================
   TYPES
======================= */

type Listing = {
  id: string;
  title: string;
  price: number;
  createdAt?: any;

  categoryName?: string;
  subCategoryName?: string;

  imageUrls?: string[];
};

type PublicProfile = {
  name?: string;
  bio?: string;
  email?: string;
  phone?: string;
  websiteInstagram?: string;
  address?: string;
  avatarUrl?: string;
};

type SellerClientProps = {
  initialProfile?: PublicProfile | null;
  initialListings?: Listing[];
};

function formatPriceTRY(v?: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${n} ₺`;
  }
}

/* =======================
   PAGE
======================= */

export default function SellerClient({
  initialProfile = null,
  initialListings = [],
}: SellerClientProps) {
  const params = useParams<{ uid: string }>();
  const uid = params?.uid;
  const router = useRouter();

  const [profile, setProfile] = useState<PublicProfile | null>(initialProfile);
  const [listings, setListings] = useState<Listing[]>(initialListings);

  const [loading, setLoading] = useState(!initialProfile);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] =
    useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const LISTINGS_PAGE_SIZE = 24;

  /* =======================
     LOAD SELLER + LISTINGS
  ======================= */

  useEffect(() => {
    if (!uid) return;

    let cancelled = false;

    async function load() {
      if (!initialProfile) setLoading(true);
      setError(null);

      try {
        /* =======================
           LOAD PUBLIC PROFILE
        ======================= */
        const profileRef = doc(db, "publicProfiles", uid);
        const profileSnap = await getDoc(profileRef);

        if (!profileSnap.exists()) {
          throw new Error("Satıcı profili bulunamadı.");
        }

        if (cancelled) return;
        setProfile(profileSnap.data() as PublicProfile);

        /* =======================
           LOAD SELLER LISTINGS
        ======================= */
        const q = query(
          collection(db, "listings"),
          where("ownerId", "==", uid),
          orderBy("createdAt", "desc"),
          limit(LISTINGS_PAGE_SIZE)
        );

        const snap = await getDocs(q);

        if (cancelled) return;

        const data = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as Listing[];

        setListings(data);
        setCursor(snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null);
        setHasMore(snap.docs.length === LISTINGS_PAGE_SIZE);
      } catch (e: any) {
        devError("Seller page error:", e);
        if (!cancelled) {
          setError(getFriendlyErrorMessage(e, "Bir hata oluştu."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  const loadMoreListings = async () => {
    if (!uid) return;
    if (!hasMore) return;
    if (!cursor) return;
    if (loadingMore) return;

    setLoadingMore(true);

    try {
      const q = query(
        collection(db, "listings"),
        where("ownerId", "==", uid),
        orderBy("createdAt", "desc"),
        startAfter(cursor),
        limit(LISTINGS_PAGE_SIZE)
      );

      const snap = await getDocs(q);
      const data = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      })) as Listing[];

      setListings((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        const merged = [...prev];
        for (const item of data) {
          if (!seen.has(item.id)) {
            merged.push(item);
            seen.add(item.id);
          }
        }
        return merged;
      });

      setCursor(snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : cursor);
      setHasMore(snap.docs.length === LISTINGS_PAGE_SIZE);
    } catch (e) {
      devError("Seller loadMore error:", e);
    } finally {
      setLoadingMore(false);
    }
  };

  /* =======================
     UI STATES
  ======================= */

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f7f4ef] px-4 py-10">
        <div className="max-w-6xl mx-auto space-y-6 animate-pulse">
          <div className="bg-white/90 rounded-3xl border border-slate-200/70 shadow-sm p-6">
            <div className="h-6 w-48 bg-slate-200 rounded mb-2" />
            <div className="h-4 w-64 bg-slate-200 rounded" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-60 bg-slate-200 rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <div className="text-red-600 font-medium mb-4">{error}</div>
        <button
          onClick={() => router.push("/")}
          className="text-blue-600 underline"
        >
          Ana sayfaya dön
        </button>
      </div>
    );
  }

  if (!profile) return null;

  /* =======================
     UI
  ======================= */

  const sellerName = profile.name || "Satıcı";

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8">

      {/* ================= HEADER ================= */}
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold">
            {sellerName}
          </h1>

          {profile.bio && (
            <div className="text-gray-700 mt-2 whitespace-pre-line">
              {profile.bio}
            </div>
          )}
        </div>

        <Link href="/" className="text-sm underline shrink-0">
          ← Ana sayfa
        </Link>
      </div>

      {/* ================= CONTACT + ADDRESS ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        <div className="border rounded-xl p-5 bg-white space-y-3">
          <h2 className="text-lg font-semibold">İletişim</h2>

          {profile.email ? (
            <div className="text-sm text-gray-700">
              E-posta:{" "}
              <a
                href={`mailto:${profile.email}`}
                className="font-medium underline"
              >
                {profile.email}
              </a>
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              E-posta bilgisi yok.
            </div>
          )}

          {profile.phone ? (
            <div className="text-sm text-gray-700">
              Telefon / WhatsApp:{" "}
              <a
                href={`https://wa.me/${profile.phone.replace(/\D/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                {profile.phone}
              </a>
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              Telefon bilgisi yok.
            </div>
          )}

          {profile.websiteInstagram && (
            <div className="text-sm text-gray-700">
              Website / Instagram:{" "}
              <a
                href={profile.websiteInstagram}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {profile.websiteInstagram}
              </a>
            </div>
          )}
        </div>

        <div className="border rounded-xl p-5 bg-white space-y-3">
          <h2 className="text-lg font-semibold">Konum</h2>

          {profile.address ? (
            <>
              <div className="text-sm text-gray-700">
                {profile.address}
              </div>

              <iframe
                className="w-full h-56 rounded-lg border"
                loading="lazy"
                src={`https://www.google.com/maps?q=${encodeURIComponent(
                  profile.address
                )}&output=embed`}
              />
            </>
          ) : (
            <div className="text-sm text-gray-500">
              Adres bilgisi yok.
            </div>
          )}
        </div>
      </div>

      {/* ================= LISTINGS ================= */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">
            Satıcının İlanları
          </h2>

          <div className="text-sm text-gray-600">
            Gösterilen: {listings.length}
            {hasMore ? "+" : ""}
          </div>
        </div>

        {listings.length === 0 ? (
          <div className="text-gray-500">
            Bu satıcının henüz ilanı yok.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {listings.map((l) => {
              const thumb = l.imageUrls?.[0];

              return (
                <Link
                  key={l.id}
                  href={buildListingPath(l.id, l.title)}
                  className="block"
                >
                  <div className="border rounded-xl overflow-hidden bg-white hover:shadow-md transition">

                    {thumb ? (
                      <img
                        src={thumb}
                        alt="ilan"
                        className="w-full h-44 object-cover"
                      />
                    ) : (
                      <div className="w-full h-44 bg-gray-100 flex items-center justify-center text-gray-400 text-sm">
                        Görsel yok
                      </div>
                    )}

                    <div className="p-4 space-y-1">
                      <div className="font-semibold line-clamp-2">
                        {l.title}
                      </div>

                      <div className="text-sm text-green-700 font-medium">
                        {formatPriceTRY(l.price)}
                      </div>

                      {(l.categoryName || l.subCategoryName) && (
                        <div className="text-xs text-gray-500">
                          {l.categoryName || ""}
                          {l.subCategoryName ? ` / ${l.subCategoryName}` : ""}
                        </div>
                      )}
                    </div>

                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {hasMore && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={loadMoreListings}
              disabled={loadingMore}
              className="px-4 py-2 rounded-full border border-slate-200 text-sm bg-white hover:bg-slate-50 disabled:opacity-60"
            >
              {loadingMore ? "Yükleniyor…" : "Daha fazla ilan yükle"}
            </button>
          </div>
        )}
      </div>

      <div className="text-xs text-gray-400">
        Satıcı UID: {uid}
      </div>
    </div>
  );
}
