"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import {
  ToastView,
  useToast,
  cx,
  formatDateTR,
  normalizeTextTR,
} from "@/app/components/admin/ui";
import { devError, getFriendlyErrorMessage } from "@/lib/logger";
import { buildListingPath } from "@/lib/listingUrl";

type ReportStatus = "open" | "investigating" | "resolved" | "closed";

type ReportRow = {
  id: string;
  status?: ReportStatus;
  targetType?: string;
  targetId?: string;
  reason?: string;
  description?: string;
  reporterId?: string;
  createdAt?: any;
  updatedAt?: any;
  resolvedAt?: any;
};

const STATUS_OPTIONS: Array<{ value: "" | ReportStatus; label: string }> = [
  { value: "", label: "Tümü" },
  { value: "open", label: "Açık" },
  { value: "investigating", label: "İnceleniyor" },
  { value: "resolved", label: "Çözüldü" },
  { value: "closed", label: "Kapalı" },
];

function StatusBadge({ s }: { s?: ReportStatus }) {
  const tone =
    s === "resolved"
      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
      : s === "investigating"
      ? "bg-amber-50 border-amber-200 text-amber-700"
      : s === "closed"
      ? "bg-slate-100 border-slate-200 text-slate-600"
      : "bg-rose-50 border-rose-200 text-rose-700";

  return (
    <span className={cx("text-[11px] px-2 py-1 rounded-xl border", tone)}>
      {s || "open"}
    </span>
  );
}

function targetLink(row: ReportRow) {
  if (row.targetType === "listing" && row.targetId) {
    return buildListingPath(row.targetId);
  }
  if (row.targetType === "user" && row.targetId) {
    return `/admin/users?uid=${row.targetId}`;
  }
  return null;
}

export default function AdminReportsPage() {
  const { toast, showToast } = useToast();

  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<"" | ReportStatus>("");
  const [searchText, setSearchText] = useState("");

  async function load() {
    if (!db) return;
    setLoading(true);
    setError(null);
    try {
      const qRef = query(
        collection(db, "reports"),
        orderBy("createdAt", "desc"),
        limit(200)
      );
      const snap = await getDocs(qRef);
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      })) as ReportRow[];
      setRows(list);
    } catch (e) {
      devError("Reports load error", e);
      setError(getFriendlyErrorMessage(e, "Raporlar yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(id: string, next: ReportStatus) {
    if (!db) return;
    try {
      const payload: Record<string, any> = {
        status: next,
        updatedAt: serverTimestamp(),
      };
      if (next === "resolved") payload.resolvedAt = serverTimestamp();
      await updateDoc(doc(db, "reports", id), payload);

      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: next } : r))
      );
      showToast({
        type: "success",
        title: "Güncellendi",
        text: `Rapor durumu → ${next}`,
      });
    } catch (e) {
      devError("Report update error", e);
      showToast({
        type: "error",
        title: "Hata",
        text: "Rapor güncellenemedi.",
      });
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const { lower } = normalizeTextTR(searchText);
    return rows.filter((r) => {
      if (statusFilter && (r.status || "open") !== statusFilter) return false;
      if (!lower) return true;
      const hay = [
        r.reason,
        r.description,
        r.targetType,
        r.targetId,
        r.reporterId,
      ]
        .map((x) => String(x || ""))
        .join(" ")
        .toLocaleLowerCase("tr-TR");
      return hay.includes(lower);
    });
  }, [rows, statusFilter, searchText]);

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
              Rapor Merkezi
            </div>
            <div className="mt-2 text-slate-600">
              Kullanıcı raporları, hedef linkleri ve çözüm akışı.
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
            onChange={(e) =>
              setStatusFilter(e.target.value as "" | ReportStatus)
            }
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm min-w-[140px]"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
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
              Rapor bulunamadı.
            </div>
          ) : (
            filtered.map((r) => {
              const href = targetLink(r);
              return (
                <div
                  key={r.id}
                  className="border border-slate-200/80 rounded-2xl bg-white/90 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge s={r.status} />
                        <div className="text-sm font-semibold text-slate-900">
                          {r.reason || "Rapor"}
                        </div>
                        <div className="text-xs text-slate-500">
                          {formatDateTR(r.createdAt)}
                        </div>
                      </div>
                      {r.description && (
                        <div className="mt-2 text-sm text-slate-700 whitespace-pre-line">
                          {r.description}
                        </div>
                      )}
                      <div className="mt-2 text-xs text-slate-500">
                        Hedef:{" "}
                        <span className="font-semibold">
                          {r.targetType || "-"}
                        </span>{" "}
                        • {r.targetId || "-"}
                      </div>
                      <div className="text-xs text-slate-500">
                        Raporlayan: {r.reporterId || "-"}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 shrink-0">
                      {href && (
                        <Link
                          href={href}
                          className="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 text-sm"
                        >
                          Hedefe git
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={() => updateStatus(r.id, "investigating")}
                        className="px-3 py-2 rounded-xl border text-sm hover:bg-amber-50"
                      >
                        İncele
                      </button>
                      <button
                        type="button"
                        onClick={() => updateStatus(r.id, "resolved")}
                        className="px-3 py-2 rounded-xl border text-sm hover:bg-emerald-50"
                      >
                        Çözüldü
                      </button>
                      <button
                        type="button"
                        onClick={() => updateStatus(r.id, "closed")}
                        className="px-3 py-2 rounded-xl border text-sm hover:bg-slate-50"
                      >
                        Kapat
                      </button>
                    </div>
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
