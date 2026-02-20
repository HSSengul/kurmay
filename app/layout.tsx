import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { unstable_cache } from "next/cache";
import "./globals.css";
import Header from "./components/Header";
import { listCollection } from "@/lib/firestoreRest";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
  "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "İlan Sitesi",
  description: "Basit ilan platformu",
  openGraph: {
    title: "İlan Sitesi",
    description: "Basit ilan platformu",
    url: siteUrl,
    images: [{ url: `${siteUrl}/opengraph-image` }],
  },
  twitter: {
    card: "summary_large_image",
    title: "İlan Sitesi",
    description: "Basit ilan platformu",
    images: [`${siteUrl}/opengraph-image`],
  },
};

export const revalidate = 300;

const getCategoriesCached = unstable_cache(
  async () => listCollection("categories", 500, 5),
  ["kf_categories_layout"],
  { revalidate: 300 }
);

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const categories = await getCategoriesCached();
  return (
    <html lang="tr">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Header initialCategories={categories} />
        {children}
      </body>
    </html>
  );
}
