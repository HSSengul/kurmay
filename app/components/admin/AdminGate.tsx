"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { onAuthStateChanged } from "firebase/auth";
import { auth, firebaseConfigReady } from "@/lib/firebase";
import { getFriendlyErrorMessage } from "@/lib/logger";

export default function AdminGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const configReady = firebaseConfigReady && !!auth;

  const [checking, setChecking] = useState(configReady);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (typeof performance === "undefined") return;
    const perf: any = performance;
    if (typeof perf.measure !== "function") return;

    const original = perf.measure.bind(perf);
    perf.measure = (...args: any[]) => {
      try {
        return original(...args);
      } catch (err: any) {
        const msg = String(err?.message || err || "");
        if (msg.includes("negative time stamp")) return;
        throw err;
      }
    };

    return () => {
      perf.measure = original;
    };
  }, []);

  useEffect(() => {
    if (!configReady || !auth) return;
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        const next =
          typeof window !== "undefined"
            ? `${window.location.pathname}${window.location.search}`
            : "/admin/dashboard";
        router.replace(`/login?next=${encodeURIComponent(next)}`);
        setChecking(false);
        return;
      }
      // Admin yetkisi middleware + admin_session cookie ile doğrulanıyor.
      // Burada sadece aktif auth oturumu olup olmadığını kontrol ediyoruz.
      setOk(true);
      setChecking(false);
    });

    return () => unsub();
  }, [configReady, router]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f7fb] bg-[radial-gradient(circle_at_top,_#ffffff,_#f5f7fb_55%)] px-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white/80 px-5 py-4 text-sm text-slate-600 shadow-[0_20px_40px_-28px_rgba(15,23,42,0.45)]">
          Kontrol ediliyor...
        </div>
      </div>
    );
  }

  if (!configReady) {
    return (
      <div className="min-h-screen bg-[#f7f4ef] px-4 py-10">
        <div className="max-w-3xl mx-auto bg-white/90 rounded-3xl border border-rose-200 shadow-sm p-8 text-center">
          <div className="text-rose-700 font-semibold mb-2">Firebase yapılandırması eksik</div>
          <div className="text-slate-700">
            {getFriendlyErrorMessage(
              null,
              "Vercel ortam değişkenlerini kontrol et: NEXT_PUBLIC_FIREBASE_* alanları eksik olabilir."
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!ok) return null;

  return <>{children}</>;
}
