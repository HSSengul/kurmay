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
        "w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm border transition",
        active
          ? "bg-gray-900 text-white border-gray-900"
          : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50 active:bg-gray-100"
      )}
    >
      <span className="text-base">{icon}</span>
      <span className="font-medium">{label}</span>
    </Link>
  );
}

export default function Sidebar() {
  return (
    <div className="border rounded-2xl bg-white p-3">
      <div className="text-xs text-gray-500 px-1">Menü</div>

      <div className="mt-2 space-y-2">
        {/* ✅ Dashboard'ı direkt dashboard route'una bağladık */}
        <SideItem href="/admin/dashboard" label="Dashboard" icon="📊" />

        <SideItem href="/admin/brands" label="Markalar" icon="🏷️" />
        <SideItem href="/admin/users" label="Kullanıcılar" icon="👤" />
        <SideItem href="/admin/listings" label="İlanlar" icon="🕰️" />
        <SideItem href="/admin/reports" label="Raporlar" icon="🚨" />

        {/* ✅ NEW: AutoFlags */}
        <SideItem href="/admin/auto-flags" label="AutoFlags" icon="🧠" />

        <SideItem href="/admin/logs" label="Loglar" icon="🧾" />
        <SideItem href="/admin/settings" label="Ayarlar" icon="⚙️" />
      </div>

      <div className="mt-4 border-t pt-3">
        <div className="text-xs text-gray-500 px-1">Katalog</div>
        <div className="mt-2 text-[11px] text-gray-500">
          Markalar içinden model yönetimi açılır.
        </div>
      </div>
    </div>
  );
}
