"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

import { auth, db } from "@/lib/firebase";
import { buildListingPath, extractListingId } from "@/lib/listingUrl";
import { devError, getFriendlyErrorMessage } from "@/lib/logger";

type Listing = {
  title?: string;
  price?: number;
  imageUrls?: string[];
  categoryName?: string;
  subCategoryName?: string;
  ownerId?: string;
};

const REASONS = [
  "Sahte ürün / replika",
  "Uygunsuz içerik",
  "Yanlış kategori",
  "Fiyat / dolandırıcılık şüphesi",
  "Spam / reklam",
  "Diğer",
];

function fmtTL(v: number) {
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${v} TL`;
  }
}

export default function ReportPage() {
  const router = useRouter();
  const search = useSearchParams();

  const rawTargetId =
    search.get("targetId") || search.get("listingId") || "";
  const targetId = extractListingId(rawTargetId);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const listingHref = useMemo(() => {
    if (!targetId) return "/";
    return buildListingPath(targetId, listing?.title || "");
  }, [targetId, listing?.title]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setCurrentUserId(u?.uid || null);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadListing() {
      if (!targetId) {
        setLoading(false);
        setError("İlan bulunamadı.");
        return;
      }
      setLoading(true);
      setError("");

      try {
        const snap = await getDoc(doc(db, "listings", targetId));
        if (!snap.exists()) {
          if (!cancelled) {
            setListing(null);
            setError("İlan bulunamadı.");
          }
          return;
        }
        if (!cancelled) {
          setListing(snap.data() as Listing);
        }
      } catch (e) {
        devError("Report listing load error", e);
        if (!cancelled) {
          setError(getFriendlyErrorMessage(e, "İlan yüklenemedi."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadListing();

    return () => {
      cancelled = true;
    };
  }, [targetId]);

  async function handleSubmit() {
    if (!currentUserId) {
      const next = `/raporla?targetId=${encodeURIComponent(targetId)}`;
      router.push(`/login?next=${encodeURIComponent(next)}`);
      return;
    }

    if (!reason) {
      setError("Lütfen bir sebep seç.");
      return;
    }

    if (reason === "Diğer" && description.trim().length < 5) {
      setError("Lütfen kısa bir açıklama yaz.");
      return;
    }

    setError("");
    setSubmitting(true);

    try {
      await addDoc(collection(db, "reports"), {
        status: "open",
        targetType: "listing",
        targetId,
        targetTitle: listing?.title || null,
        targetPath: listingHref,
        listingOwnerId: listing?.ownerId || null,
        categoryName: listing?.categoryName || null,
        subCategoryName: listing?.subCategoryName || null,
        reason,
        description: description.trim() || null,
        reporterId: currentUserId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setSent(true);
    } catch (e) {
      devError("Report submit error", e);
      setError(getFriendlyErrorMessage(e, "Rapor gönderilemedi."));
    } finally {
      setSubmitting(false);
    }
  }

  if (!authReady || loading) {
    return (
      <div className="min-h-screen bg-[#f7f4ef] px-4 py-10">
        <div className="max-w-3xl mx-auto rounded-3xl border border-[#ead8c5] bg-white/85 p-6">
          Yükleniyor...
        </div>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-[#f7f4ef] px-4 py-10">
        <div className="max-w-3xl mx-auto rounded-3xl border border-[#ead8c5] bg-white/85 p-6 space-y-4">
          <div className="text-xl font-semibold text-[#3f2a1a]">
            Raporun alındı
          </div>
          <div className="text-sm text-[#6b4b33]">
            Teşekkürler. Ekibimiz raporu inceleyecek.
          </div>
          <Link
            href={listingHref}
            className="inline-flex items-center rounded-full border border-[#ead8c5] px-4 py-2 text-sm font-semibold hover:bg-[#fff7ed]"
          >
            İlana geri dön
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f4ef] px-4 py-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="rounded-3xl border border-[#ead8c5] bg-white/85 p-6 shadow-[0_24px_60px_-45px_rgba(15,23,42,0.45)]">
          <div className="text-xs uppercase tracking-[0.2em] text-[#9b7b5a]">
            Raporlama
          </div>
          <div className="mt-2 text-2xl font-semibold text-[#3f2a1a]">
            İlanı raporla
          </div>
          <div className="mt-2 text-sm text-[#6b4b33]">
            Bu ilan kurallara aykırıysa bize bildir.
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="rounded-3xl border border-[#ead8c5] bg-white/85 p-6 space-y-4">
          <div className="text-sm font-semibold text-[#3f2a1a]">
            İlan bilgisi
          </div>

          {listing ? (
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-2xl overflow-hidden bg-[#f3e9db] border border-[#ead8c5] flex-shrink-0">
                {listing.imageUrls?.[0] ? (
                  <Image
                    src={listing.imageUrls[0]}
                    alt={listing.title || "ilan"}
                    width={80}
                    height={80}
                    sizes="80px"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-[#9b7b5a]">
                    Görsel yok
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[#3f2a1a] line-clamp-2">
                  {listing.title || "İlan"}
                </div>
                <div className="text-xs text-[#8a6a4f]">
                  {listing.categoryName || "Kategori"} / {listing.subCategoryName || "Alt kategori"}
                </div>
                <div className="text-sm font-semibold text-[#1f2a24]">
                  {fmtTL(Number(listing.price ?? 0))}
                </div>
              </div>
              <Link
                href={listingHref}
                className="ml-auto text-xs font-semibold text-[#6b4b33] hover:text-[#3f2a1a]"
              >
                İlana git →
              </Link>
            </div>
          ) : (
            <div className="text-sm text-[#9b7b5a]">
              İlan bilgisi alınamadı.
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-[#ead8c5] bg-white/85 p-6 space-y-4">
          <div className="text-sm font-semibold text-[#3f2a1a]">
            Rapor sebebi
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={`rounded-2xl border px-4 py-2 text-sm text-left ${
                  reason === r
                    ? "border-[#1f2a24] bg-[#1f2a24] text-white"
                    : "border-[#ead8c5] hover:bg-[#fff7ed] text-[#3f2a1a]"
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <div>
            <div className="text-xs text-[#8a6a4f] mb-2">
              Açıklama (opsiyonel)
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full min-h-[120px] rounded-2xl border border-[#ead8c5] bg-white/80 px-4 py-3 text-sm"
              placeholder="Kısaca açıkla..."
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className={`px-5 py-2.5 rounded-full text-sm font-semibold ${
                submitting
                  ? "bg-[#b9c9bf] text-white cursor-not-allowed"
                  : "bg-[#a03a2e] hover:bg-[#8f2f25] text-white"
              }`}
            >
              {submitting ? "Gönderiliyor..." : "Raporu gönder"}
            </button>

            <Link
              href={listingHref}
              className="text-sm font-semibold text-[#6b4b33] hover:text-[#3f2a1a]"
            >
              Vazgeç
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
