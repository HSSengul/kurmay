"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const MENU_ITEMS: Array<{ href: string; label: string; icon: string }> = [
  { href: "/admin/dashboard", label: "Dashboard", icon: "DB" },
  { href: "/admin/categories", label: "Kategoriler", icon: "KT" },
  { href: "/admin/listings", label: "Ilanlar", icon: "IL" },
  { href: "/admin/listings/new", label: "Ilan Ekle", icon: "IE" },
  { href: "/admin/users", label: "Kullanicilar", icon: "US" },
  { href: "/admin/reports", label: "Raporlar", icon: "RP" },
  { href: "/admin/auto-flags", label: "Auto Flags", icon: "AF" },
  { href: "/admin/logs", label: "Loglar", icon: "LG" },
  { href: "/admin/settings", label: "Ayarlar", icon: "AY" },
  { href: "/admin/haritalar", label: "Harita", icon: "MP" },
  { href: "/admin/schemas", label: "Semalar", icon: "SC" },
  { href: "/admin/listing-schemas", label: "Sema Editor", icon: "SE" },
];

function SideItem({
  href,
  label,
  icon,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active =
    pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cx(
        "w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm border transition",
        active
          ? "bg-[#0f172a] text-white border-[#0f172a] shadow-[0_10px_25px_-18px_rgba(15,23,42,0.6)]"
          : "bg-white/70 text-slate-700 border-slate-200 hover:bg-slate-50 active:bg-slate-100"
      )}
    >
      <span
        className={cx(
          "h-6 w-6 rounded-md flex items-center justify-center text-[10px] font-semibold border",
          active ? "border-white/40 bg-white/10" : "border-slate-300 bg-slate-50"
        )}
      >
        {icon}
      </span>
      <span className="font-medium">{label}</span>
    </Link>
  );
}

export default function Sidebar({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div
      className={cx(
        "border border-slate-200/80 rounded-2xl bg-white/80 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)]",
        mobile ? "p-2" : "p-3"
      )}
    >
      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500 px-2">
        Menu
      </div>

      <div className="mt-2 space-y-2">
        {MENU_ITEMS.map((item) => (
          <SideItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      <div className="mt-4 border-t border-slate-200/70 pt-3 px-2">
        <div className="text-[11px] text-slate-500">Katalog ve moderasyon islemleri buradan yonetilir.</div>
      </div>
    </div>
  );
}
