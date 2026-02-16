// app/my/messages/new/NewConversationClient.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import { devError, getFriendlyErrorMessage } from "@/lib/logger";

function safeText(v: any, fallback = "") {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function clampString(v: any, max: number, fallback = "") {
  const s = safeText(v, fallback);
  if (!s) return fallback;
  return s.slice(0, max);
}

export default function NewConversationClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const listingId = searchParams.get("listingId") || "";
  const sellerId = searchParams.get("sellerId") || "";
  const missingParams = !listingId || !sellerId;

  const [error, setError] = useState<string>(
    missingParams ? "Eksik bilgi: ilan veya satıcı bulunamadı." : ""
  );
  const [loading, setLoading] = useState(!missingParams);

  useEffect(() => {
    let cancelled = false;

    if (missingParams) return;

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        const nextUrl = `/my/messages/new?listingId=${encodeURIComponent(
          listingId
        )}&sellerId=${encodeURIComponent(sellerId)}`;
        router.replace(`/login?next=${encodeURIComponent(nextUrl)}`);
        return;
      }

      try {
        setLoading(true);
        setError("");

        const listingSnap = await getDoc(doc(db, "listings", listingId));
        if (!listingSnap.exists()) {
          setError("İlan bulunamadı.");
          setLoading(false);
          return;
        }

        const listing = listingSnap.data() as any;
        const ownerId = safeText(listing.ownerId);

        if (!ownerId || ownerId !== sellerId) {
          setError("Satıcı bilgisi uyuşmuyor.");
          setLoading(false);
          return;
        }

        if (user.uid === sellerId) {
          setError("Kendi ilanına mesaj başlatamazsın.");
          setLoading(false);
          return;
        }

        // Mevcut konuşma var mı?
        const existingQuery = query(
          collection(db, "conversations"),
          where("listingId", "==", listingId),
          where("buyerId", "==", user.uid),
          where("sellerId", "==", sellerId),
          limit(1)
        );
        const existingSnap = await getDocs(existingQuery);
        if (!existingSnap.empty) {
          router.replace(`/my/messages/${existingSnap.docs[0].id}`);
          return;
        }

        const [buyerProfileSnap, sellerProfileSnap] = await Promise.all([
          getDoc(doc(db, "publicProfiles", user.uid)),
          getDoc(doc(db, "publicProfiles", sellerId)),
        ]);

        const buyerProfile = buyerProfileSnap.exists()
          ? (buyerProfileSnap.data() as any)
          : {};
        const sellerProfile = sellerProfileSnap.exists()
          ? (sellerProfileSnap.data() as any)
          : {};

        const buyerDisplayName =
          clampString(
            buyerProfile?.displayName || buyerProfile?.name || user.displayName,
            120,
            ""
          ) || "Kullanıcı";
        const sellerDisplayName =
          clampString(
            sellerProfile?.displayName || sellerProfile?.name,
            120,
            ""
          ) || "Satıcı";

        const now = serverTimestamp();
        const convoPayload = {
          listingId,
          buyerId: user.uid,
          sellerId,
          participants: [user.uid, sellerId],
          createdAt: now,
          lastMessageAt: now,
          unread: { buyer: 0, seller: 0 },
          deletedFor: { buyer: false, seller: false },
          status: "active",
          listingSnapshot: {
            title: clampString(listing?.title, 200, "İlan"),
            price: Number(listing?.price ?? 0),
            categoryName: clampString(listing?.categoryName, 120, "Kategori"),
            subCategoryName: clampString(
              listing?.subCategoryName,
              120,
              "Alt kategori"
            ),
            imageUrl: Array.isArray(listing?.imageUrls)
              ? listing.imageUrls?.[0] ?? null
              : null,
          },
          sellerSnapshot: {
            publicProfileId: sellerId,
            displayName: sellerDisplayName,
          },
          buyerSnapshot: {
            displayName: buyerDisplayName,
          },
          lastReadAt: { buyer: now },
          typing: { buyer: false, seller: false, updatedAt: now },
        };

        const docRef = await addDoc(collection(db, "conversations"), convoPayload);

        if (!cancelled) {
          router.replace(`/my/messages/${docRef.id}`);
        }
      } catch (e: any) {
        devError("NewConversationPage error:", e);
        if (!cancelled) {
          setError(getFriendlyErrorMessage(e, "Sohbet başlatılamadı."));
          setLoading(false);
        }
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [listingId, sellerId, router, missingParams]);

  if (loading) {
    return (
      <div className="min-h-[60vh] px-4 py-12 flex items-center justify-center">
        <div className="w-full max-w-md rounded-3xl border border-[#ead8c5] bg-white/90 p-6 text-center shadow-[0_24px_60px_-45px_rgba(15,23,42,0.45)]">
          <div className="text-lg font-semibold text-[#3f2a1a]">
            Sohbet hazırlanıyor...
          </div>
          <div className="mt-2 text-sm text-[#6b4b33]">
            Lütfen bekle, mesaj sayfasına yönlendiriliyorsun.
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[60vh] px-4 py-12 flex items-center justify-center">
        <div className="w-full max-w-md rounded-3xl border border-red-200 bg-red-50 p-6 text-center shadow-[0_24px_60px_-45px_rgba(15,23,42,0.45)]">
          <div className="text-red-700 font-semibold mb-2">Sohbet bulunamadı</div>
          <div className="text-sm text-red-700">{error}</div>
          <button
            onClick={() => router.push("/my/messages")}
            className="mt-5 inline-flex items-center justify-center rounded-full border border-red-200 bg-white px-5 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 transition"
          >
            Mesajlara dön
          </button>
        </div>
      </div>
    );
  }

  return null;
}
