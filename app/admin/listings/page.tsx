"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import {
  ToastView,
  useToast,
  cx,
  formatDateTR,
  normalizeTextTR,
} from "@/app/components/admin/ui";
import { devError, getFriendlyErrorMessage } from "@/lib/logger";
import { buildListingPath } from "@/lib/listingUrl";

type ListingStatus = "active" | "review" | "hidden" | "removed";

type ListingRow = {
  id: string;
  title?: string;
  price?: number;
  imageUrls?: string[];
  categoryName?: string;
  subCategoryName?: string;
  ownerId?: string;
  createdAt?: any;
  adminStatus?: ListingStatus;
  adminNote?: string;
};

const STATUS_OPTIONS: Array<{ value: "" | ListingStatus; label: string }> = [
  { value: "", label: "Tümü" },
  { value: "active", label: "Aktif" },
  { value: "review", label: "İncelemede" },
  { value: "hidden", label: "Gizli" },
  { value: "removed", label: "Kaldırıldı" },
];

function formatPriceTRY(v?: number) {
  if (!Number.isFinite(v)) return "-";
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 0,
    }).format(v as number);
  } catch {
    return `${v} ₺`;
  }
}

export default function AdminListingsPage() {
  const { toast, showToast } = useToast();

  const [rows, setRows] = useState<ListingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | ListingStatus>("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    if (!db) return;
    setLoading(true);
    setError(null);
    try {
      const qRef = query(
        collection(db, "listings"),
        orderBy("createdAt", "desc"),
        limit(200)
      );
      const snap = await getDocs(qRef);
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      })) as ListingRow[];
      setRows(list);
    } catch (e) {
      devError("Admin listings load error", e);
      setError(getFriendlyErrorMessage(e, "İlanlar yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const categories = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.categoryName && s.add(r.categoryName));
    return Array.from(s.values()).sort((a, b) =>
      a.localeCompare(b, "tr")
    );
  }, [rows]);

  const filtered = useMemo(() => {
    const { lower } = normalizeTextTR(searchText);
    return rows.filter((r) => {
      if (statusFilter && (r.adminStatus || "active") !== statusFilter)
        return false;
      if (categoryFilter && r.categoryName !== categoryFilter) return false;
      if (!lower) return true;
      const hay = [
        r.title,
        r.categoryName,
        r.subCategoryName,
        r.ownerId,
        r.id,
      ]
        .map((x) => String(x || ""))
        .join(" ")
        .toLocaleLowerCase("tr-TR");
      return hay.includes(lower);
    });
  }, [rows, searchText, statusFilter, categoryFilter]);

  async function updateStatus(id: string, next: ListingStatus) {
    if (!db) return;
    setSavingId(id);
    try {
      await updateDoc(doc(db, "listings", id), {
        adminStatus: next,
        adminReviewedAt: serverTimestamp(),
        adminReviewedBy: auth?.currentUser?.uid || null,
      });
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, adminStatus: next } : r))
      );
      showToast({
        type: "success",
        title: "Güncellendi",
        text: "İlan durumu güncellendi.",
      });
    } catch (e) {
      devError("Listing status update error", e);
      showToast({
        type: "error",
        title: "Hata",
        text: "İlan güncellenemedi.",
      });
    } finally {
      setSavingId(null);
    }
  }

  async function saveNote(id: string) {
    if (!db) return;
    setSavingId(id);
    try {
      const note = (noteDrafts[id] || "").trim();
      await updateDoc(doc(db, "listings", id), {
        adminNote: note,
        adminReviewedAt: serverTimestamp(),
        adminReviewedBy: auth?.currentUser?.uid || null,
      });
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, adminNote: note } : r))
      );
      showToast({
        type: "success",
        title: "Kaydedildi",
        text: "Not güncellendi.",
      });
    } catch (e) {
      devError("Listing note update error", e);
      showToast({
        type: "error",
        title: "Hata",
        text: "Not kaydedilemedi.",
      });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <ToastView toast={toast} />

      <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-6 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
              Admin
            </div>
            <div className="mt-1 text-xl font-semibold text-slate-900">
              İlan Moderasyonu
            </div>
            <div className="mt-2 text-slate-600">
              Şüpheli ilanları kontrol et, durum değiştir, not bırak.
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            className={cx(
              "px-3 py-2 rounded-xl bg-gray-900 text-white text-sm",
              loading ? "opacity-60 pointer-events-none" : ""
            )}
          >
            ⟳ Yenile
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 items-center">
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Ara..."
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm min-w-[220px]"
          />
          <select
            value={statusFilter}
            onChange={(e) => {
              const next = e.target.value as ListingStatus | "";
              setStatusFilter(next);
            }}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm min-w-[140px]"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm min-w-[160px]"
          >
            <option value="">Tüm kategoriler</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <div className="ml-auto text-xs text-slate-500">
            Toplam: <span className="font-semibold">{filtered.length}</span>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="mt-4 space-y-3">
          {loading ? (
            <div className="text-sm text-slate-500">Yükleniyor...</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-slate-500">
              İlan bulunamadı.
            </div>
          ) : (
            filtered.map((r) => {
              const img = r.imageUrls?.[0];
              const status = r.adminStatus || "active";
              return (
                <div
                  key={r.id}
                  className="border border-slate-200/80 rounded-2xl bg-white/90 p-4"
                >
                  <div className="flex flex-col lg:flex-row gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="h-20 w-20 rounded-xl bg-slate-100 overflow-hidden shrink-0">
                        {img ? (
                          <Image
                            src={img}
                            alt={r.title || "ilan"}
                            width={80}
                            height={80}
                            className="h-20 w-20 object-cover"
                          />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center text-xs text-slate-400">
                            Görsel yok
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 line-clamp-2">
                          {r.title || "İlan"}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          {r.categoryName || "-"} / {r.subCategoryName || "-"}
                        </div>
                        <div className="text-xs text-slate-500">
                          {formatDateTR(r.createdAt)}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 items-center lg:ml-auto">
                      <div className="text-lg font-semibold text-emerald-700">
                        {formatPriceTRY(r.price)}
                      </div>
                      <select
                        value={status}
                        onChange={(e) =>
                          updateStatus(r.id, e.target.value as ListingStatus)
                        }
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                        disabled={savingId === r.id}
                      >
                        <option value="active">Aktif</option>
                        <option value="review">İncelemede</option>
                        <option value="hidden">Gizli</option>
                        <option value="removed">Kaldırıldı</option>
                      </select>

                      <Link
                        href={buildListingPath(r.id, r.title)}
                        className="px-3 py-2 rounded-xl border text-sm hover:bg-slate-50"
                      >
                        İlan
                      </Link>
                      {r.ownerId && (
                        <Link
                          href={`/seller/${r.ownerId}`}
                          className="px-3 py-2 rounded-xl border text-sm hover:bg-slate-50"
                        >
                          Satıcı
                        </Link>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3">
                    <textarea
                      value={noteDrafts[r.id] ?? r.adminNote ?? ""}
                      onChange={(e) =>
                        setNoteDrafts((p) => ({
                          ...p,
                          [r.id]: e.target.value,
                        }))
                      }
                      rows={2}
                      placeholder="Admin notu..."
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-200 focus:border-slate-300 bg-white/90 placeholder:text-slate-400"
                    />
                    <button
                      type="button"
                      onClick={() => saveNote(r.id)}
                      disabled={savingId === r.id}
                      className={cx(
                        "px-3 py-2 rounded-xl bg-gray-900 text-white text-sm h-fit",
                        savingId === r.id ? "opacity-60 pointer-events-none" : ""
                      )}
                    >
                      Notu kaydet
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
