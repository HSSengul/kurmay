import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Harita",
  description: "Yuklenen ilanlari harita uzerinde goruntule.",
};

export default function HaritaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
