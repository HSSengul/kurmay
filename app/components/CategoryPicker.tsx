"use client";

import { useEffect, useMemo, useState } from "react";
import { getCategoriesCached } from "@/lib/catalogCache";

/* =========================
   TYPES
========================= */

type CategoryDoc = {
  name: string;
  nameLower: string;
  parentId: string | null;
  order: number;
  enabled: boolean;
  icon?: string;
};

type CategoryRow = CategoryDoc & { id: string };

export type CategoryPickerValue = {
  categoryId: string;
  categoryName: string;
  subCategoryId: string;
  subCategoryName: string;
};

type Props = {
  value: CategoryPickerValue;
  onChange: (next: CategoryPickerValue) => void;

  requireSubCategory?: boolean;
  disabled?: boolean;
  className?: string;
};

/* =========================
   HELPERS
========================= */

function safeSort(a?: number, b?: number) {
  const aa = Number.isFinite(a as any) ? (a as number) : 0;
  const bb = Number.isFinite(b as any) ? (b as number) : 0;
  return aa - bb;
}

export default function CategoryPicker({
  value,
  onChange,
  requireSubCategory = true,
  disabled = false,
  className = "",
}: Props) {
  const [loading, setLoading] = useState(true);
  const [all, setAll] = useState<CategoryRow[]>([]);
  const [err, setErr] = useState("");

  async function load(force = false) {
    setErr("");
    setLoading(true);
    try {
      const cached = await getCategoriesCached({ force });
      const rows: CategoryRow[] = (cached || [])
        .map((d: any) => ({ id: d.id, ...(d as CategoryDoc) }))
        .filter((x) => x.enabled !== false);
      setAll(rows);
    } catch (e: any) {
      setErr(e?.message || "Kategoriler yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const mains = useMemo(() => {
    return all
      .filter((x) => x.parentId == null)
      .sort((a, b) => safeSort(a.order, b.order));
  }, [all]);

  const subs = useMemo(() => {
    return all
      .filter((x) => x.parentId === value.categoryId)
      .sort((a, b) => safeSort(a.order, b.order));
  }, [all, value.categoryId]);

  function setMain(nextId: string) {
    const main = mains.find((x) => x.id === nextId);
    const next: CategoryPickerValue = {
      categoryId: nextId,
      categoryName: main?.name || "",
      subCategoryId: "",
      subCategoryName: "",
    };
    onChange(next);
  }

  function setSub(nextId: string) {
    const sub = subs.find((x) => x.id === nextId);
    const next: CategoryPickerValue = {
      ...value,
      subCategoryId: nextId,
      subCategoryName: sub?.name || "",
    };
    onChange(next);
  }

  const mainValid = !!value.categoryId;
  const subValid = !requireSubCategory || !!value.subCategoryId;

  return (
    <div className={`w-full ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">Kategori</div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={disabled}
          className="text-xs px-2 py-1 rounded-md border hover:bg-gray-50 disabled:opacity-60"
        >
          Yenile
        </button>
      </div>

      {err ? (
        <div className="mb-3 p-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {err}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* MAIN */}
        <div>
          <label className="text-xs text-gray-600">Ana kategori</label>
          <select
            disabled={disabled || loading}
            value={value.categoryId}
            onChange={(e) => setMain(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-lg border bg-white disabled:opacity-60"
          >
            <option value="">{loading ? "Yükleniyor…" : "Seçiniz"}</option>
            {mains.map((m) => (
              <option key={m.id} value={m.id}>
                {(m.icon ? `${m.icon} ` : "") + m.name}
              </option>
            ))}
          </select>
          {!mainValid ? (
            <div className="text-xs text-red-600 mt-1">Ana kategori seçmelisin.</div>
          ) : null}
        </div>

        {/* SUB */}
        <div>
          <label className="text-xs text-gray-600">Alt kategori</label>
          <select
            disabled={disabled || loading || !value.categoryId}
            value={value.subCategoryId}
            onChange={(e) => setSub(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-lg border bg-white disabled:opacity-60"
          >
            <option value="">{value.categoryId ? "Seçiniz" : "Önce ana kategori seç"}</option>
            {subs.map((s) => (
              <option key={s.id} value={s.id}>
                {(s.icon ? `${s.icon} ` : "") + s.name}
              </option>
            ))}
          </select>

          {!subValid ? (
            <div className="text-xs text-red-600 mt-1">Alt kategori seçmelisin.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
