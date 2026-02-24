"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import Sidebar from "./Sidebar";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const quickLinks = useMemo(
    () => [
      { href: "/admin/dashboard", label: "Panel" },
      { href: "/admin/categories", label: "Kategori" },
      { href: "/admin/listings", label: "Ilan" },
      { href: "/admin/users", label: "Kullanici" },
    ],
    []
  );

  return (
    <div className="admin-root min-h-screen bg-[#f5f7fb] bg-[radial-gradient(circle_at_top,_#ffffff,_#f5f7fb_55%)] text-[#0f172a]">
      <div className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur-xl">
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
                Yonetim Merkezi
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="hidden sm:inline-flex px-3 py-2 rounded-xl bg-[#0f172a] text-white hover:bg-[#1f2937] active:bg-black text-sm shadow-sm"
            >
              Siteye Don
            </Link>

            <span
              className={cx(
                "hidden xl:inline-flex px-3 py-2 rounded-xl border border-slate-200 text-sm",
                "bg-white/80 text-slate-600"
              )}
              title={pathname}
            >
              {pathname}
            </span>

            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden h-10 w-10 rounded-xl border border-slate-200 bg-white text-slate-700 text-lg"
              aria-label="Admin menusu"
            >
              <span className="mx-auto block h-0.5 w-4 bg-current mb-1" />
              <span className="mx-auto block h-0.5 w-4 bg-current mb-1" />
              <span className="mx-auto block h-0.5 w-4 bg-current" />
            </button>
          </div>
        </div>

        <div className="lg:hidden border-t border-slate-200/70">
          <nav className="max-w-7xl mx-auto px-4 py-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {quickLinks.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cx(
                    "rounded-lg border px-2 py-2 text-center text-[11px] font-semibold",
                    active
                      ? "bg-[#0f172a] text-white border-[#0f172a]"
                      : "bg-white text-slate-700 border-slate-200"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-4">
          <aside className="hidden lg:block lg:sticky lg:top-[98px] h-fit">
            <Sidebar />
          </aside>

          <main className="min-w-0">{children}</main>
        </div>
      </div>

      <div
        className={cx(
          "fixed inset-0 z-50 lg:hidden",
          mobileMenuOpen ? "pointer-events-auto" : "pointer-events-none"
        )}
      >
        <button
          type="button"
          aria-label="Menuyu kapat"
          onClick={() => setMobileMenuOpen(false)}
          className={cx(
            "absolute inset-0 bg-slate-900/45 transition-opacity",
            mobileMenuOpen ? "opacity-100" : "opacity-0"
          )}
        />
        <aside
          className={cx(
            "absolute left-0 top-0 h-full w-[86vw] max-w-[340px] border-r border-slate-200 bg-[#f8fafc] p-3 shadow-2xl transition-transform",
            mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <div className="text-sm font-semibold text-slate-900">Admin Menusu</div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-700 text-base"
            >
              x
            </button>
          </div>
          <Sidebar mobile onNavigate={() => setMobileMenuOpen(false)} />
        </aside>
      </div>
    </div>
  );
}
