import type { Metadata } from "next";
import type { ReactNode } from "react";
import AdminGate from "../../app/components/admin/AdminGate";
import AdminShell from "../../app/components/admin/AdminShell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminGate>
      <AdminShell>{children}</AdminShell>
    </AdminGate>
  );
}
