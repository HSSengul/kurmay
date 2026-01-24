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
} from "firebase/firestore";
import { db } from "@/lib/firebase";

/* =======================
   TYPES
======================= */

type Listing = {
  id: string;
  title: string;
  price: number;
  createdAt?: any;

  brandName?: string;
  modelName?: string;

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

/* =======================
   PAGE
======================= */

export default function SellerPage() {
  const params = useParams<{ uid: string }>();
  const uid = params?.uid;
  const router = useRouter();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* =======================
     LOAD SELLER + LISTINGS
  ======================= */

  useEffect(() => {
    if (!uid) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
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
          orderBy("createdAt", "desc")
        );

        const snap = await getDocs(q);

        if (cancelled) return;

        const data = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as Listing[];

        setListings(data);
      } catch (e: any) {
        console.error("Seller page error:", e);
        if (!cancelled) setError(e.message || "Bir hata oluştu.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  /* =======================
     UI STATES
  ======================= */

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">
        Yükleniyor...
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
            Toplam: {listings.length}
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
                  href={`/ilan/${l.id}`}
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
                        {l.price} TL
                      </div>

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

      <div className="text-xs text-gray-400">
        Seller UID: {uid}
      </div>
    </div>
  );
}
