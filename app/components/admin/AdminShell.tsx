"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top header */}
      <div className="sticky top-0 z-20 border-b bg-white/90 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-gray-500">Admin Panel</div>
            <div className="text-lg sm:text-xl font-semibold text-gray-900 truncate">
              Yönetim Merkezi
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50 active:bg-gray-100 text-sm"
            >
              Siteye Dön
            </Link>

            <span
              className={cx(
                "hidden sm:inline-flex px-3 py-2 rounded-xl border text-sm",
                "bg-white text-gray-600"
              )}
              title={pathname}
            >
              {pathname}
            </span>
          </div>
        </div>
      </div>

      {/* Layout */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
          <aside className="lg:sticky lg:top-[72px] h-fit">
            <Sidebar />
          </aside>

          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
