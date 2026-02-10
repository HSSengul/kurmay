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
    <div className="min-h-screen bg-[#f5f7fb] bg-[radial-gradient(circle_at_top,_#ffffff,_#f5f7fb_55%)] text-[#0f172a]">
      {/* Top header */}
      <div className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/70 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-[#0f172a] text-white flex items-center justify-center text-sm font-semibold">
              KF
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                Admin Panel
              </div>
              <div className="text-lg sm:text-xl font-semibold text-slate-900 truncate">
                Yönetim Merkezi
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="px-3 py-2 rounded-xl bg-[#0f172a] text-white hover:bg-[#1f2937] active:bg-black text-sm shadow-sm"
            >
              Siteye Dön
            </Link>

            <span
              className={cx(
                "hidden sm:inline-flex px-3 py-2 rounded-xl border border-slate-200 text-sm",
                "bg-white/80 text-slate-600"
              )}
              title={pathname}
            >
              {pathname}
            </span>
          </div>
        </div>
      </div>

      {/* Layout */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
          <aside className="lg:sticky lg:top-[86px] h-fit">
            <Sidebar />
          </aside>

          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
