"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import {
  Field,
  ToastView,
  useToast,
  cx,
  formatDateTR,
} from "@/app/components/admin/ui";
import { devError, getFriendlyErrorMessage } from "@/lib/logger";

type MapSettings = {
  aggregateBelowZoom: number;
  listMinZoom: number;
  updatedAt?: any;
  updatedBy?: string | null;
};

const DEFAULTS: MapSettings = {
  aggregateBelowZoom: 11,
  listMinZoom: 12,
};

function toInt(value: string, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(22, Math.round(n)));
}

export default function AdminMapsPage() {
  const { toast, showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<MapSettings>(DEFAULTS);
  const [initial, setInitial] = useState<MapSettings>(DEFAULTS);

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial]
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!db) return;
      setLoading(true);
      setError(null);
      try {
        const ref = doc(db, "publicSettings", "maps");
        const snap = await getDoc(ref);
        const data = snap.exists()
          ? ({ ...DEFAULTS, ...(snap.data() as any) } as MapSettings)
          : DEFAULTS;
        if (cancelled) return;
        setForm(data);
        setInitial(data);
      } catch (e) {
        devError("Map settings load error", e);
        if (!cancelled) {
          setError(getFriendlyErrorMessage(e, "Harita ayarları yüklenemedi."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    if (!db) return;
    setSaving(true);
    setError(null);
    try {
      const payload: MapSettings = {
        aggregateBelowZoom: toInt(
          String(form.aggregateBelowZoom),
          DEFAULTS.aggregateBelowZoom
        ),
        listMinZoom: toInt(
          String(form.listMinZoom),
          DEFAULTS.listMinZoom
        ),
        updatedAt: serverTimestamp(),
        updatedBy: auth?.currentUser?.uid || null,
      };

      await setDoc(doc(db, "publicSettings", "maps"), payload, { merge: true });

      setForm(payload);
      setInitial(payload);

      showToast({
        type: "success",
        title: "Kaydedildi",
        text: "Harita ayarları güncellendi.",
      });
    } catch (e) {
      devError("Map settings save error", e);
      setError(getFriendlyErrorMessage(e, "Harita ayarları kaydedilemedi."));
      showToast({
        type: "error",
        title: "Hata",
        text: "Harita ayarları kaydedilemedi.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <ToastView toast={toast} />

      <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-4 sm:p-6 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)]">
        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
          Admin
        </div>
        <div className="mt-1 text-xl font-semibold text-slate-900">
          Haritalar
        </div>
        <div className="mt-2 text-slate-600">
          Harita görüntüsü ve liste eşikleri.
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="border border-slate-200/80 rounded-2xl bg-slate-50 p-5 space-y-4">
            <div className="text-sm font-semibold text-slate-900">
              Toplama & Liste
            </div>
            <Field
              label="Tek top moduna geçiş zoom seviyesi"
              value={String(form.aggregateBelowZoom)}
              onChange={(v) =>
                setForm((p) => ({
                  ...p,
                  aggregateBelowZoom: toInt(v, DEFAULTS.aggregateBelowZoom),
                }))
              }
              type="number"
            />
            <Field
              label="Sağ liste minimum zoom seviyesi"
              value={String(form.listMinZoom)}
              onChange={(v) =>
                setForm((p) => ({
                  ...p,
                  listMinZoom: toInt(v, DEFAULTS.listMinZoom),
                }))
              }
              type="number"
            />
            <div className="text-xs text-slate-500">
              Öneri: Liste eşiği, tek top eşiğinden büyük olmalı.
            </div>
          </div>

          <div className="border border-slate-200/80 rounded-2xl bg-slate-50 p-5 space-y-3">
            <div className="text-sm font-semibold text-slate-900">Durum</div>
            <div className="text-sm text-slate-600">
              Son güncelleme:{" "}
              <span className="font-semibold">
                {formatDateTR(form.updatedAt)}
              </span>
            </div>
            <div className="text-sm text-slate-600">
              Güncelleyen:{" "}
              <span className="font-semibold">
                {form.updatedBy || "-"}
              </span>
            </div>
            <div className="text-xs text-slate-500">
              Değişiklikleri kaydetmeden çıkarsan kaybolur.
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={save}
            className={cx(
              "px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-black",
              saving || loading ? "opacity-60 pointer-events-none" : ""
            )}
          >
            {saving ? "Kaydediliyor..." : "Kaydet"}
          </button>
          <button
            type="button"
            onClick={() => {
              setForm(initial);
            }}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 hover:bg-slate-50"
          >
            Vazgeç
          </button>
          {!dirty && !loading && (
            <span className="text-xs text-slate-500">Değişiklik yok.</span>
          )}
        </div>
      </div>
    </div>
  );
}
