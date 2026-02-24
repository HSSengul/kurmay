"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
  doc,
  where,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { ToastView, useToast, cx, formatDateTR } from "@/app/components/admin/ui";
import { devError } from "@/lib/logger";

type AutoFlagStatus = "open" | "investigating" | "resolved";

type AutoFlagRow = {
  id: string;
  type: string;
  severity: "low" | "medium" | "high";
  status: AutoFlagStatus;

  targetType: "listing" | "user" | "message";
  targetId: string;
  targetPath: string;

  sampleText?: string | null;
  meta?: Record<string, any>;

  createdAt?: any;
  updatedAt?: any;
  resolvedAt?: any;
  investigatingAt?: any;
};

function SeverityBadge({ s }: { s: AutoFlagRow["severity"] }) {
  const cls =
    s === "high"
      ? "bg-red-50 border-red-200 text-red-700"
      : s === "medium"
      ? "bg-yellow-50 border-yellow-200 text-yellow-800"
      : "bg-green-50 border-green-200 text-green-700";

  return (
    <span className={cx("text-[11px] px-2 py-1 rounded-xl border", cls)}>{s}</span>
  );
}

function TypeLabel(t: string) {
  if (!t) return "flag";
  switch (t) {
    case "lowPrice":
      return "Düşük Fiyat";
    case "bannedWordsListing":
      return "Yasaklı Kelime (İlan)";
    case "bannedWordsMessage":
      return "Yasaklı Kelime (Mesaj)";
    case "newAccountHighActivity":
      return "Yeni Hesap + Çok Aktivite";
    default:
      return t;
  }
}

/* =========================
   TARGET NAV HELPERS
========================= */

function parseConversationIdFromTargetPath(targetPath?: string) {
  if (!targetPath) return null;
  const parts = String(targetPath).split("/").filter(Boolean);
  const convIdx = parts.indexOf("conversations");
  if (convIdx >= 0 && parts[convIdx + 1]) return parts[convIdx + 1];
  return null;
}

function parseMessageIdFromTargetPath(targetPath?: string) {
  if (!targetPath) return null;
  const parts = String(targetPath).split("/").filter(Boolean);
  const msgIdx = parts.indexOf("messages");
  if (msgIdx >= 0 && parts[msgIdx + 1]) return parts[msgIdx + 1];
  return null;
}

function getAdminTargetHref(row: AutoFlagRow): string | null {
  if (!row?.targetType || !row?.targetId) return null;

  if (row.targetType === "listing") {
    return `/admin/listings?listingId=${encodeURIComponent(row.targetId)}`;
  }
  if (row.targetType === "user") return `/admin/users?uid=${row.targetId}`;

  if (row.targetType === "message") {
    const convId =
      (row.meta?.conversationId as string | undefined) ||
      parseConversationIdFromTargetPath(row.targetPath);

    const msgId =
      (row.meta?.messageId as string | undefined) ||
      parseMessageIdFromTargetPath(row.targetPath);

    if (!convId) return null;
    const params = new URLSearchParams();
    params.set("conversationId", convId);
    if (msgId) params.set("messageId", msgId);
    return `/admin/logs?${params.toString()}`;
  }

  return null;
}

export default function AdminAutoFlagsPage() {
  const { toast, showToast } = useToast();

  const [rows, setRows] = useState<AutoFlagRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [status, setStatus] = useState<AutoFlagStatus>("open");

  async function load() {
    setLoading(true);
    try {
      let list: AutoFlagRow[] = [];

      // ✅ 1) updatedAt desc dene
      try {
        const qRef = query(
          collection(db, "autoFlags"),
          where("status", "==", status),
          orderBy("updatedAt", "desc"),
          limit(50)
        );
        const snap = await getDocs(qRef);
        list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as AutoFlagRow[];
      } catch {
        // ✅ 2) createdAt desc dene
        try {
          const qRef2 = query(
            collection(db, "autoFlags"),
            where("status", "==", status),
            orderBy("createdAt", "desc"),
            limit(50)
          );
          const snap2 = await getDocs(qRef2);
          list = snap2.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as AutoFlagRow[];
        } catch {
          // ✅ 3) orderBy'sız fallback
          const qRef3 = query(
            collection(db, "autoFlags"),
            where("status", "==", status),
            limit(50)
          );
          const snap3 = await getDocs(qRef3);
          list = snap3.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as AutoFlagRow[];
        }
      }

      setRows(list);

      showToast({
        type: "success",
        title: "Güncellendi",
        text: `Oto Bayraklar listesi yenilendi (${status}).`,
      });
    } catch (e) {
      devError("Auto flags load error", e);
      setRows([]);
      showToast({
        type: "error",
        title: "Hata",
        text: "Oto Bayraklar çekilemedi (rules / index kontrol et).",
      });
    } finally {
      setLoading(false);
    }
  }

  async function setFlagStatus(flagId: string, next: AutoFlagStatus) {
    try {
      const payload: Record<string, any> = {
        status: next,
        updatedAt: serverTimestamp(),
      };

      if (next === "investigating") payload.investigatingAt = serverTimestamp();
      if (next === "resolved") payload.resolvedAt = serverTimestamp();

      await updateDoc(doc(db, "autoFlags", flagId), payload);

      showToast({
        type: "success",
        title: "Güncellendi",
        text: `Durum değişti → ${next}`,
      });

      // aktif filtreye göre listeden çıkar
      setRows((prev) => prev.filter((x) => x.id !== flagId));
    } catch (e) {
      devError("Auto flag status update error", e);
      showToast({
        type: "error",
        title: "Hata",
        text: "Status güncellenemedi (rules kontrol et).",
      });
    }
  }

  useEffect(() => {
    load();
  }, [status]);

  async function copyPath(path: string) {
    if (!path) {
      showToast({
        type: "info",
        title: "Path yok",
        text: "Bu flag kaydinda targetPath bulunamadi.",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(path);
      showToast({
        type: "success",
        title: "Kopyalandi",
        text: "Target path panoya kopyalandi.",
      });
    } catch {
      showToast({
        type: "error",
        title: "Kopyalanamadi",
        text: "Tarayici pano izni vermedi.",
      });
    }
  }

  return (
    <div className="space-y-4">
      <ToastView toast={toast} />

      <div className="border rounded-2xl bg-white p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-gray-500">Admin</div>
            <div className="mt-1 text-xl font-semibold text-gray-900">Oto Bayraklar</div>
            <div className="mt-1 text-sm text-gray-600">
              Risk motorunun ürettiği otomatik uyarılar. KVKK açısından içerik minimum tutulur.
            </div>
            <div className="mt-2 text-[11px] text-gray-500">
              Durum: <span className="font-semibold">{status}</span> • Listede:{" "}
              <span className="font-semibold">{rows.length}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/dashboard"
              className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
            >
              ← Kontrol Paneli
            </Link>

            <button
              type="button"
              onClick={load}
              className={cx(
                "px-3 py-2 rounded-xl bg-gray-900 text-white hover:bg-black text-sm",
                loading ? "opacity-60 pointer-events-none" : ""
              )}
            >
              ⟳ Yenile
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <button
            className={cx(
              "px-3 py-2 rounded-xl border text-sm",
              status === "open"
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white hover:bg-gray-50"
            )}
            onClick={() => setStatus("open")}
          >
            Açık (open)
          </button>

          <button
            className={cx(
              "px-3 py-2 rounded-xl border text-sm",
              status === "investigating"
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white hover:bg-gray-50"
            )}
            onClick={() => setStatus("investigating")}
          >
            İncelemede (investigating)
          </button>

          <button
            className={cx(
              "px-3 py-2 rounded-xl border text-sm",
              status === "resolved"
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white hover:bg-gray-50"
            )}
            onClick={() => setStatus("resolved")}
          >
            Çözülen (resolved)
          </button>

          {loading && <span className="text-xs text-gray-500 ml-2">Yükleniyor…</span>}
        </div>
      </div>

      <div className="border rounded-2xl bg-white p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">Liste (max 50)</div>
          <div className="text-xs text-gray-500">status == {status}</div>
        </div>

        <div className="mt-4 space-y-2">
          {rows.length === 0 ? (
            <div className="border rounded-2xl bg-gray-50 p-5 text-gray-700">
              <div className="font-semibold text-gray-900">Şimdilik kayıt yok ✅</div>
              <div className="mt-1 text-sm">Risk tespiti geldikçe burada listelenecek.</div>
            </div>
          ) : (
            rows.map((r) => {
              const href = getAdminTargetHref(r);

              return (
                <div
                  key={r.id}
                  className="border rounded-2xl p-4 hover:bg-gray-50 transition"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-sm font-semibold text-gray-900">
                          {TypeLabel(r.type)}
                        </div>
                        <SeverityBadge s={r.severity} />
                        <span className="text-[11px] px-2 py-1 rounded-xl border bg-white text-gray-600">
                          {r.targetType}
                        </span>
                        <span className="text-[11px] px-2 py-1 rounded-xl border bg-white text-gray-600">
                          {r.status}
                        </span>
                      </div>

                      <div className="mt-2 text-xs text-gray-500 break-all">
                        Target: <span className="font-mono">{r.targetPath}</span>
                      </div>

                      {r.sampleText ? (
                        <div className="mt-2 text-sm text-gray-800 whitespace-pre-wrap">
                          “{String(r.sampleText)}”
                        </div>
                      ) : (
                        <div className="mt-2 text-xs text-gray-500">(sampleText yok)</div>
                      )}

                      <div className="mt-2 text-[11px] text-gray-500">
                        {formatDateTR(r.updatedAt || r.createdAt)}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 shrink-0 w-full sm:w-auto">
                      {href ? (
                        <Link
                          href={href}
                          className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 text-sm text-center"
                        >
                          🚀 Hedefe Git
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 text-sm"
                          onClick={() =>
                            showToast({
                              type: "info",
                              title: "Link yok",
                              text: "Bu flag için hedef route üretilemedi (meta / targetPath eksik).",
                            })
                          }
                        >
                          🚫 Hedefe Git
                        </button>
                      )}

                      {status === "open" ? (
                        <>
                          <button
                            onClick={() => setFlagStatus(r.id, "investigating")}
                            className="px-3 py-2 rounded-xl bg-yellow-600 text-white hover:bg-yellow-700 text-sm"
                          >
                            🕵️ İncelemede
                          </button>

                          <button
                            onClick={() => setFlagStatus(r.id, "resolved")}
                            className="px-3 py-2 rounded-xl bg-green-600 text-white hover:bg-green-700 text-sm"
                          >
                            ✅ Resolved
                          </button>
                        </>
                      ) : null}

                      {status === "investigating" ? (
                        <>
                          <button
                            onClick={() => setFlagStatus(r.id, "resolved")}
                            className="px-3 py-2 rounded-xl bg-green-600 text-white hover:bg-green-700 text-sm"
                          >
                            ✅ Resolved
                          </button>

                          <button
                            onClick={() => setFlagStatus(r.id, "open")}
                            className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 text-sm"
                          >
                            ↩️ Tekrar Aç
                          </button>
                        </>
                      ) : null}

                      {status === "resolved" ? (
                        <button
                          onClick={() => setFlagStatus(r.id, "open")}
                          className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 text-sm"
                        >
                          ↩️ Re-open
                        </button>
                      ) : null}

                      <button
                        onClick={() => copyPath(String(r.targetPath || ""))}
                        className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 text-sm"
                      >
                        📋 Path kopyala
                      </button>

                      <span className="text-[11px] px-2 py-1 rounded-xl border bg-white text-gray-600 text-center">
                        {r.id.slice(0, 6)}…
                      </span>
                    </div>
                  </div>

                  {r.meta && Object.keys(r.meta || {}).length > 0 ? (
                    <div className="mt-3 border rounded-2xl bg-white p-3">
                      <div className="text-[11px] font-semibold text-gray-700">meta</div>
                      <pre className="mt-1 text-[11px] text-gray-600 overflow-auto">
{JSON.stringify(r.meta, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="text-[11px] text-gray-500">
        Not: Oto Bayraklar ekranı sadece autoFlags koleksiyonunu okur. KVKK açısından içerik minimum tutulur.
      </div>
    </div>
  );
}
