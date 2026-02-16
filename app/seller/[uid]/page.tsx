import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SellerClient from "./SellerClient";
import { fetchDocument, runQueryByField } from "@/lib/firestoreRest";

export const revalidate = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PublicProfileDoc = {
  name?: string;
  bio?: string;
  email?: string;
  phone?: string;
  websiteInstagram?: string;
  address?: string;
  avatarUrl?: string;
  isPrivate?: boolean;
  visibility?: string;
  public?: boolean;
};

type ListingDoc = {
  title: string;
  price: number;
  createdAt?: any;
  categoryName?: string;
  subCategoryName?: string;
  imageUrls?: string[];
};

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";

const clampMeta = (v: string, max = 160) => {
  const t = (v || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t;
};

const isProfilePrivate = (p?: PublicProfileDoc | null) => {
  if (!p) return false;
  if (p.isPrivate === true) return true;
  if (p.visibility === "private") return true;
  if (p.public === false) return true;
  return false;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ uid: string }> | { uid: string };
}): Promise<Metadata> {
  const resolved = await params;
  const profile = await fetchDocument<PublicProfileDoc>(
    "publicProfiles",
    resolved.uid
  );
  if (!profile) {
    return {
      title: "Satıcı bulunamadı",
      robots: { index: false, follow: false },
    };
  }

  const sellerName = profile.name || "Satıcı";
  const title = `${sellerName} | Satıcı Profili`;
  const description = clampMeta(
    profile.bio || `${sellerName} tarafından yayınlanan ilanlar.`
  );
  const ogImage = `${siteUrl}/opengraph-image`;

  return {
    title,
    description,
    alternates: {
      canonical: `${siteUrl}/seller/${resolved.uid}`,
    },
    openGraph: {
      title,
      description,
      url: `${siteUrl}/seller/${resolved.uid}`,
      images: [{ url: ogImage }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
    robots: isProfilePrivate(profile)
      ? { index: false, follow: false }
      : undefined,
  };
}

export default async function SellerPage({
  params,
}: {
  params: Promise<{ uid: string }> | { uid: string };
}) {
  const resolved = await params;
  const profile = await fetchDocument<PublicProfileDoc>(
    "publicProfiles",
    resolved.uid
  );
  if (!profile) notFound();

  const listings = await runQueryByField<ListingDoc>({
    collectionId: "listings",
    fieldPath: "ownerId",
    value: resolved.uid,
    orderByField: "createdAt",
    direction: "DESCENDING",
    limit: 12,
  });

  return (
    <SellerClient
      initialProfile={profile}
      initialListings={listings}
    />
  );
}
