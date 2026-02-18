import type { Metadata } from "next";
import AdminShell from "@/app/components/admin/AdminShell";
import AdminGate from "@/app/components/admin/AdminGate";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminGate>
      <AdminShell>{children}</AdminShell>
    </AdminGate>
  );
}
