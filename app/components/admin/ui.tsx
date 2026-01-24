"use client";

import { useEffect, useRef, useState } from "react";

/* =========================
   UI HELPERS
========================= */

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function safeString(v: any, fallback = ""): string {
  if (typeof v === "string") return v;
  if (v == null) return fallback;
  return String(v);
}

function getTimestampMillis(ts: any): number {
  if (!ts) return 0;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  return 0;
}

export function formatDateTR(ts: any) {
  const ms = getTimestampMillis(ts);
  if (!ms) return "-";
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return "-";
  }
}

export function normalizeTextTR(input: string) {
  const trimmed = input.trim().replace(/\s+/g, " ");
  const lower = trimmed.toLocaleLowerCase("tr-TR");
  return { trimmed, lower };
}

export function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function toNumOrNull(v: string) {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      return true;
    } catch {
      return false;
    }
  }
}

/* =========================
   TOAST
========================= */

export type Toast =
  | { type: "success" | "error" | "info"; title?: string; text: string }
  | null;

export function useToast(durationMs = 2500) {
  const [toast, setToast] = useState<Toast>(null);
  const timerRef = useRef<any>(null);

  function showToast(t: Toast) {
    setToast(t);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), durationMs);
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { toast, showToast, setToast };
}

export function ToastView({ toast }: { toast: Toast }) {
  if (!toast) return null;

  const base =
    "fixed z-[999] left-1/2 -translate-x-1/2 top-4 w-[calc(100%-24px)] max-w-xl px-4 py-3 rounded-xl shadow border text-sm";
  const tone =
    toast.type === "success"
      ? "bg-green-50 border-green-200 text-green-900"
      : toast.type === "error"
      ? "bg-red-50 border-red-200 text-red-900"
      : "bg-blue-50 border-blue-200 text-blue-900";

  return (
    <div className={cx(base, tone)}>
      <div className="font-semibold">
        {toast.title ||
          (toast.type === "success"
            ? "Başarılı"
            : toast.type === "error"
            ? "Hata"
            : "Bilgi")}
      </div>
      <div className="mt-0.5 opacity-90">{toast.text}</div>
    </div>
  );
}

/* =========================
   SKELETON
========================= */

function SkeletonLine({ w = "w-2/3" }: { w?: string }) {
  return <div className={cx("h-3 bg-gray-200 rounded animate-pulse", w)} />;
}

export function SkeletonCard() {
  return (
    <div className="border rounded-2xl bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="space-y-2 w-full">
          <SkeletonLine w="w-1/3" />
          <SkeletonLine w="w-1/2" />
        </div>
      </div>
    </div>
  );
}

/* =========================
   STAT CARD
========================= */

export function StatCard({
  title,
  value,
  hint,
  icon,
}: {
  title: string;
  value: string;
  hint?: string;
  icon?: string;
}) {
  return (
    <div className="border rounded-2xl bg-white p-4 hover:bg-gray-50 transition">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-gray-500">{title}</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">
            {value}
          </div>
          {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
        </div>
        {icon && (
          <div className="h-10 w-10 rounded-xl border bg-white flex items-center justify-center text-lg">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================
   INPUT FIELD
========================= */

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "number";
}) {
  return (
    <label className="block">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || label}
        type={type}
        className="w-full border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-gray-200 bg-white"
      />
    </label>
  );
}
