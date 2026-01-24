import type { ReactNode } from "react";
import AdminGate from "../../app/components/admin/AdminGate";
import AdminShell from "../../app/components/admin/AdminShell";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminGate>
      <AdminShell>{children}</AdminShell>
    </AdminGate>
  );
}
