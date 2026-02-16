"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
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

type AdminLogRow = {
  id: string;
  action?: string;
  message?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  actorName?: string;
  createdAt?: any;
  meta?: Record<string, any>;
};

export default function AdminLogsPage() {
  const { toast, showToast } = useToast();

  const [rows, setRows] = useState<AdminLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchText, setSearchText] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const [noteText, setNoteText] = useState("");
  const [noteEntityType, setNoteEntityType] = useState("");
  const [noteEntityId, setNoteEntityId] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!db) return;
    setLoading(true);
    setError(null);
    try {
      const qRef = query(
        collection(db, "adminLogs"),
        orderBy("createdAt", "desc"),
        limit(200)
      );
      const snap = await getDocs(qRef);
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setRows(list as AdminLogRow[]);
    } catch (e) {
      devError("Admin logs load error", e);
      setError(getFriendlyErrorMessage(e, "Loglar yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }

  async function addNote() {
    if (!db) return;
    if (!noteText.trim()) return;
    setSaving(true);
    try {
      await addDoc(collection(db, "adminLogs"), {
        action: "note",
        message: noteText.trim(),
        entityType: noteEntityType.trim() || null,
        entityId: noteEntityId.trim() || null,
        actorId: auth?.currentUser?.uid || null,
        actorName: auth?.currentUser?.displayName || null,
        createdAt: serverTimestamp(),
      });
      setNoteText("");
      setNoteEntityId("");
      setNoteEntityType("");
      showToast({
        type: "success",
        title: "Kaydedildi",
        text: "Not loglara eklendi.",
      });
      load();
    } catch (e) {
      devError("Admin logs add error", e);
      showToast({
        type: "error",
        title: "Hata",
        text: "Not kaydedilemedi.",
      });
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const { lower } = normalizeTextTR(searchText);
    return rows.filter((r) => {
      if (typeFilter && (r.action || "") !== typeFilter) return false;
      if (!lower) return true;
      const hay = [
        r.action,
        r.message,
        r.entityType,
        r.entityId,
        r.actorId,
        r.actorName,
      ]
        .map((x) => String(x || ""))
        .join(" ")
        .toLocaleLowerCase("tr-TR");
      return hay.includes(lower);
    });
  }, [rows, searchText, typeFilter]);

  const actionOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.action && s.add(r.action));
    return Array.from(s.values()).sort();
  }, [rows]);

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
              Admin Loglar
            </div>
            <div className="mt-2 text-slate-600">
              İşlem kayıtları ve manuel notlar.
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

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4">
          <div className="border border-slate-200/80 rounded-2xl bg-slate-50 p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-900">
              Manuel not
            </div>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={4}
              placeholder="Örn: Kullanıcı X için uyarı verildi."
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-200 focus:border-slate-300 bg-white/90 placeholder:text-slate-400"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                value={noteEntityType}
                onChange={(e) => setNoteEntityType(e.target.value)}
                placeholder="Entity type (listing/user)"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
              <input
                value={noteEntityId}
                onChange={(e) => setNoteEntityId(e.target.value)}
                placeholder="Entity id"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={addNote}
              className={cx(
                "px-3 py-2 rounded-xl bg-gray-900 text-white text-sm",
                saving ? "opacity-60 pointer-events-none" : ""
              )}
            >
              {saving ? "Kaydediliyor..." : "Not ekle"}
            </button>
          </div>

          <div className="border border-slate-200/80 rounded-2xl bg-slate-50 p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-900">Filtre</div>
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Ara..."
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm w-full"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm w-full"
            >
              <option value="">Tüm aksiyonlar</option>
              {actionOptions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <div className="text-xs text-slate-500">
              Toplam: <span className="font-semibold">{filtered.length}</span>
            </div>
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
              Log kaydı bulunamadı.
            </div>
          ) : (
            filtered.map((r) => (
              <div
                key={r.id}
                className="border border-slate-200/80 rounded-2xl bg-white/90 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">
                      {r.action || "log"}
                    </div>
                    {r.message && (
                      <div className="mt-1 text-sm text-slate-700 whitespace-pre-line">
                        {r.message}
                      </div>
                    )}
                    <div className="mt-1 text-xs text-slate-500">
                      {r.entityType || "-"} • {r.entityId || "-"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {r.actorName || r.actorId || "-"}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 shrink-0">
                    {formatDateTR(r.createdAt)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
