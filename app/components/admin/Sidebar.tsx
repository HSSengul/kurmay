"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function SideItem({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: string;
}) {
  const pathname = usePathname();
  const active =
    pathname === href || (href !== "/admin" && pathname.startsWith(href));

  return (
    <Link
      href={href}
      className={cx(
        "w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm border transition",
        active
          ? "bg-[#0f172a] text-white border-[#0f172a] shadow-[0_10px_25px_-18px_rgba(15,23,42,0.6)]"
          : "bg-white/70 text-slate-700 border-slate-200 hover:bg-slate-50 active:bg-slate-100"
      )}
    >
      <span className="text-base">{icon}</span>
      <span className="font-medium">{label}</span>
    </Link>
  );
}

export default function Sidebar() {
  return (
    <div className="border border-slate-200/80 rounded-2xl bg-white/80 p-3 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)]">
      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500 px-2">
        Menü
      </div>

      <div className="mt-2 space-y-2">
        {/* ✅ Dashboard'ı direkt dashboard route'una bağladık */}
        <SideItem href="/admin/dashboard" label="Kontrol Paneli" icon="📊" />

        <SideItem href="/admin/categories" label="Kategoriler" icon="🏷️" />
        <SideItem href="/admin/users" label="Kullanıcılar" icon="👤" />
        <SideItem href="/admin/listings" label="İlanlar" icon="🕰️" />
        <SideItem href="/admin/reports" label="Raporlar" icon="🚨" />

        {/* ✅ NEW: AutoFlags */}
        <SideItem href="/admin/auto-flags" label="Oto Bayraklar" icon="🧠" />

        <SideItem href="/admin/logs" label="Loglar" icon="🧾" />
        <SideItem href="/admin/settings" label="Ayarlar" icon="⚙️" />
      </div>

      <div className="mt-4 border-t border-slate-200/70 pt-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500 px-2">
          Katalog
        </div>
        <div className="mt-2 text-[11px] text-slate-500 px-2">
          Kategoriler içinden alt kategori yönetimi açılır.
        </div>
      </div>
    </div>
  );
}
