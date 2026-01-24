"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

/* ================= TYPES ================= */

type UserProfile = {
  displayName?: string;
  email?: string;
  phone?: string;
};

type Listing = {
  id: string;
  title: string;
  price: number;
  brandName: string;
  modelName: string;
};

/* ================= PAGE ================= */

export default function SellerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [seller, setSeller] = useState<UserProfile | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  /* ================= LOAD SELLER ================= */

  useEffect(() => {
    if (!id) return;

    async function loadSeller() {
      const snap = await getDoc(doc(db, "users", id));

      if (!snap.exists()) {
        setSeller(null);
        setLoading(false);
        return;
      }

      setSeller(snap.data() as UserProfile);

      const q = query(
        collection(db, "listings"),
        where("ownerId", "==", id)
      );

      const listSnap = await getDocs(q);

      setListings(
        listSnap.docs.map((d) => ({
          id: d.id,
          title: d.data().title,
          price: d.data().price,
          brandName: d.data().brandName,
          modelName: d.data().modelName,
        }))
      );

      setLoading(false);
    }

    loadSeller();
  }, [id]);

  /* ================= UI STATES ================= */

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">
        Yükleniyor...
      </div>
    );
  }

  if (!seller) {
    return (
      <div className="p-8 text-center">
        Satıcı bulunamadı.
      </div>
    );
  }

  /* ================= UI ================= */

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">

      <div className="border rounded-xl p-6 space-y-2">
        <h1 className="text-2xl font-bold">
          {seller.displayName || "Satıcı"}
        </h1>

        {seller.email && <div>{seller.email}</div>}
        {seller.phone && <div>{seller.phone}</div>}
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">
          Satıcının İlanları
        </h2>

        {listings.length === 0 ? (
          <div className="text-gray-500">
            Satıcının ilanı yok.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {listings.map((l) => (
              <div
                key={l.id}
                onClick={() => router.push(`/ilan/${l.id}`)}
                className="border rounded-xl p-4 cursor-pointer hover:shadow-md"
              >
                <div className="font-semibold">{l.title}</div>
                <div className="text-sm text-gray-600">
                  {l.brandName} / {l.modelName}
                </div>
                <div className="text-green-600 font-semibold">
                  {l.price} TL
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
