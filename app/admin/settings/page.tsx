"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { auth, db, storage } from "@/lib/firebase";
import {
  Field,
  ToastView,
  useToast,
  cx,
  formatDateTR,
} from "@/app/components/admin/ui";
import { devError, getFriendlyErrorMessage } from "@/lib/logger";

type AdminSettings = {
  siteName: string;
  brandLogoUrl?: string;
  maintenanceMode: boolean;
  maintenanceMessage: string;

  allowNewListings: boolean;
  allowMessaging: boolean;
  maxListingImages: number;
  listingAutoExpireDays: number;

  reportAutoCloseDays: number;
  banThreshold: number;
  bannedWords: string[];

  updatedAt?: any;
  updatedBy?: string | null;
};

const DEFAULTS: AdminSettings = {
  siteName: "İlanSitesi",
  brandLogoUrl: "",
  maintenanceMode: false,
  maintenanceMessage: "Kısa bir bakım yapıyoruz. Lütfen biraz sonra tekrar deneyin.",
  allowNewListings: true,
  allowMessaging: true,
  maxListingImages: 5,
  listingAutoExpireDays: 120,
  reportAutoCloseDays: 7,
  banThreshold: 3,
  bannedWords: [],
};

function Toggle({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={cx(
        "w-full text-left border rounded-2xl px-4 py-3 transition",
        value
          ? "border-emerald-200 bg-emerald-50/70"
          : "border-slate-200 bg-white"
      )}
      aria-pressed={value}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{label}</div>
          {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
        </div>
        <div
          className={cx(
            "h-6 w-11 rounded-full border flex items-center px-1 transition",
            value
              ? "bg-emerald-600 border-emerald-600 justify-end"
              : "bg-slate-200 border-slate-200 justify-start"
          )}
        >
          <div className="h-4 w-4 bg-white rounded-full shadow-sm" />
        </div>
      </div>
    </button>
  );
}

export default function AdminSettingsPage() {
  const { toast, showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<AdminSettings>(DEFAULTS);
  const [initial, setInitial] = useState<AdminSettings>(DEFAULTS);
  const [bannedWordsText, setBannedWordsText] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);

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
        const ref = doc(db, "adminSettings", "global");
        const snap = await getDoc(ref);
        const data = snap.exists()
          ? ({ ...DEFAULTS, ...(snap.data() as any) } as AdminSettings)
          : DEFAULTS;
        if (cancelled) return;
        setForm(data);
        setInitial(data);
        setBannedWordsText((data.bannedWords || []).join("\n"));
      } catch (e) {
        devError("Admin settings load error", e);
        if (!cancelled) {
          setError(getFriendlyErrorMessage(e, "Ayarlar yüklenemedi."));
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

  async function uploadBrandLogo(file: File) {
    if (!file || !db || !storage) return;
    setError(null);

    const allowed = ["image/jpeg", "image/png", "image/webp"];
    const maxBytes = 2 * 1024 * 1024;

    if (!allowed.includes(file.type)) {
      setError("Sadece JPG / PNG / WEBP yükleyebilirsin.");
      return;
    }
    if (file.size > maxBytes) {
      setError("Logo çok büyük. 2MB altı yükle.");
      return;
    }

    try {
      setLogoUploading(true);
      const safeName = file.name.replace(/[^\w.-]+/g, "_");
      const imageRef = ref(
        storage,
        `brandAssets/logo/${Date.now()}_${safeName}`
      );
      await uploadBytes(imageRef, file);
      const url = await getDownloadURL(imageRef);

      const payload = {
        brandLogoUrl: url,
        updatedAt: serverTimestamp(),
        updatedBy: auth?.currentUser?.uid || null,
      };

      await setDoc(doc(db, "adminSettings", "global"), payload, { merge: true });
      await setDoc(
        doc(db, "publicSettings", "global"),
        {
          siteName: form.siteName,
          brandLogoUrl: url,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setForm((p) => ({ ...p, brandLogoUrl: url }));
      setInitial((p) => ({ ...p, brandLogoUrl: url }));
    } catch (e) {
      devError("Admin logo upload error", e);
      setError(getFriendlyErrorMessage(e, "Logo yüklenemedi."));
    } finally {
      setLogoUploading(false);
    }
  }

  async function save() {
    if (!db) return;
    setSaving(true);
    setError(null);
    try {
      const words = bannedWordsText
        .split(/\r?\n|,/)
        .map((w) => w.trim())
        .filter(Boolean)
        .slice(0, 300);

      const payload: AdminSettings = {
        ...form,
        bannedWords: words,
        updatedAt: serverTimestamp(),
        updatedBy: auth?.currentUser?.uid || null,
      };

      await setDoc(doc(db, "adminSettings", "global"), payload, { merge: true });
      await setDoc(
        doc(db, "publicSettings", "global"),
        {
          siteName: payload.siteName,
          brandLogoUrl: payload.brandLogoUrl || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setForm(payload);
      setInitial(payload);

      showToast({
        type: "success",
        title: "Kaydedildi",
        text: "Ayarlar güncellendi.",
      });
    } catch (e) {
      devError("Admin settings save error", e);
      setError(getFriendlyErrorMessage(e, "Ayarlar kaydedilemedi."));
      showToast({
        type: "error",
        title: "Hata",
        text: "Ayarlar kaydedilemedi.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <ToastView toast={toast} />

      <div className="border border-slate-200/80 rounded-2xl bg-white/85 p-6 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)]">
        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
          Admin
        </div>
        <div className="mt-1 text-xl font-semibold text-slate-900">Ayarlar</div>
        <div className="mt-2 text-slate-600">
          Site genel davranışı, moderasyon ve limitler.
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="border border-slate-200/80 rounded-2xl bg-slate-50 p-5 space-y-4">
            <div className="text-sm font-semibold text-slate-900">Genel</div>
            <Field
              label="Site adı"
              value={form.siteName}
              onChange={(v) => setForm((p) => ({ ...p, siteName: v }))}
              placeholder="Site adı"
            />
            <div className="space-y-2">
              <div className="text-sm font-semibold text-slate-900">
                Logo (Header)
              </div>
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full border border-slate-200 bg-white flex items-center justify-center overflow-hidden">
                  {form.brandLogoUrl ? (
                    <img
                      src={form.brandLogoUrl}
                      alt="Logo"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-xs text-slate-500">Yok</span>
                  )}
                </div>
                <div className="flex-1">
                  <Field
                    label="Logo URL"
                    value={form.brandLogoUrl || ""}
                    onChange={(v) =>
                      setForm((p) => ({ ...p, brandLogoUrl: v }))
                    }
                    placeholder="https://..."
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    disabled={logoUploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadBrandLogo(file);
                    }}
                  />
                  {logoUploading ? "Yükleniyor..." : "Logo yükle"}
                </label>
                <div className="text-xs text-slate-500">
                  JPG / PNG / WEBP, max 2MB
                </div>
              </div>
            </div>
            <Toggle
              label="Bakım modu"
              value={form.maintenanceMode}
              onChange={(v) => setForm((p) => ({ ...p, maintenanceMode: v }))}
              hint="Bakım modu açıkken yeni aksiyonlar engellenebilir."
            />
            <Field
              label="Bakım mesajı"
              value={form.maintenanceMessage}
              onChange={(v) =>
                setForm((p) => ({ ...p, maintenanceMessage: v }))
              }
              placeholder="Bakım mesajı"
            />
          </div>

          <div className="border border-slate-200/80 rounded-2xl bg-slate-50 p-5 space-y-4">
            <div className="text-sm font-semibold text-slate-900">Pazar</div>
            <Toggle
              label="Yeni ilanlara izin ver"
              value={form.allowNewListings}
              onChange={(v) => setForm((p) => ({ ...p, allowNewListings: v }))}
            />
            <Toggle
              label="Mesajlaşmaya izin ver"
              value={form.allowMessaging}
              onChange={(v) => setForm((p) => ({ ...p, allowMessaging: v }))}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Maks. fotoğraf"
                value={String(form.maxListingImages)}
                onChange={(v) =>
                  setForm((p) => ({
                    ...p,
                    maxListingImages: Number(v || 0),
                  }))
                }
                type="number"
              />
              <Field
                label="İlan auto-expire (gün)"
                value={String(form.listingAutoExpireDays)}
                onChange={(v) =>
                  setForm((p) => ({
                    ...p,
                    listingAutoExpireDays: Number(v || 0),
                  }))
                }
                type="number"
              />
            </div>
          </div>

          <div className="border border-slate-200/80 rounded-2xl bg-slate-50 p-5 space-y-4">
            <div className="text-sm font-semibold text-slate-900">Moderasyon</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Rapor auto-close (gün)"
                value={String(form.reportAutoCloseDays)}
                onChange={(v) =>
                  setForm((p) => ({
                    ...p,
                    reportAutoCloseDays: Number(v || 0),
                  }))
                }
                type="number"
              />
              <Field
                label="Ban eşiği (adet)"
                value={String(form.banThreshold)}
                onChange={(v) =>
                  setForm((p) => ({
                    ...p,
                    banThreshold: Number(v || 0),
                  }))
                }
                type="number"
              />
            </div>
            <label className="block">
              <div className="text-xs text-slate-500 mb-1">Yasaklı kelimeler</div>
              <textarea
                value={bannedWordsText}
                onChange={(e) => setBannedWordsText(e.target.value)}
                rows={6}
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-200 focus:border-slate-300 bg-white/90 placeholder:text-slate-400"
                placeholder="Her satıra bir kelime yaz"
              />
              <div className="text-[11px] text-slate-500 mt-1">
                {bannedWordsText
                  .split(/\r?\n|,/)
                  .map((x) => x.trim())
                  .filter(Boolean).length || 0}{" "}
                kelime
              </div>
            </label>
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

        <div className="mt-6 flex items-center gap-2">
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
              setBannedWordsText((initial.bannedWords || []).join("\n"));
            }}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 hover:bg-slate-50"
          >
            Vazgeç
          </button>
          {!dirty && !loading && (
            <span className="text-xs text-slate-500">
              Değişiklik yok.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
