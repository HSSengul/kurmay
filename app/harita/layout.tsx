import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "İlan Haritası",
  description: "Yüklenen ilanları harita üzerinde görüntüle.",
};

export default function HaritaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
