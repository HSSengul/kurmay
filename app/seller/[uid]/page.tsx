import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import SellerClient from "./SellerClient";
import { fetchDocument, runActiveQueryByField } from "@/lib/firestoreRest";
import { isPublicListingVisible } from "@/lib/listingVisibility";

export const revalidate = 300;
export const runtime = "nodejs";

type PublicProfileDoc = {
  name?: string;
  bio?: string;
  email?: string;
  phone?: string;
  websiteInstagram?: string;
  address?: string;
  avatarUrl?: string;
  showPhone?: boolean;
  showAddress?: boolean;
  showWebsiteInstagram?: boolean;
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
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
  "http://localhost:3000";

const clampMeta = (v: string, max = 160) => {
  const t = (v || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t;
};

const formatPriceTRY = (v?: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${n} ₺`;
  }
};

const buildListingMeta = (listings: ListingDoc[]) => {
  const titles = listings
    .map((l) => (l.title || "").trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 3);
  const prices = listings
    .map((l) => Number(l.price))
    .filter((n) => Number.isFinite(n) && n > 0);

  const parts: string[] = [];
  if (titles.length > 0) {
    parts.push(`Öne çıkan ilanlar: ${titles.join(", ")}.`);
  }
  if (prices.length > 0) {
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min === max) {
      parts.push(`Fiyat: ${formatPriceTRY(min)}.`);
    } else {
      parts.push(`Fiyat aralığı: ${formatPriceTRY(min)} – ${formatPriceTRY(max)}.`);
    }
  }
  return parts.join(" ");
};

const getListingsForMeta = unstable_cache(
  async (uid: string) =>
    runActiveQueryByField<ListingDoc>({
      collectionId: "listings",
      fieldPath: "ownerId",
      value: uid,
      orderByField: "createdAt",
      direction: "DESCENDING",
      limit: 6,
    }),
  ["kf_seller_meta_listings"],
  { revalidate: 300 }
);

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
  const listingsForMeta = (await getListingsForMeta(resolved.uid)).filter(
    (item) => isPublicListingVisible(item as any)
  );
  const extraMeta = buildListingMeta(listingsForMeta);
  const description = clampMeta(
    `${profile.bio?.trim() || `${sellerName} satıcısının güncel ilanlarını keşfet. Hızlı iletişim ve güvenli alışveriş.`} ${extraMeta}`.trim()
  );

  const ogImage =
    profile.avatarUrl ||
    listingsForMeta.find((l) => Array.isArray(l.imageUrls) && l.imageUrls[0])
      ?.imageUrls?.[0] ||
    `${siteUrl}/opengraph-image`;

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
      images: [
        {
          url: ogImage,
          alt: sellerName,
        },
      ],
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

  const listings = (await runActiveQueryByField<ListingDoc>({
    collectionId: "listings",
    fieldPath: "ownerId",
    value: resolved.uid,
    orderByField: "createdAt",
    direction: "DESCENDING",
    limit: 12,
  })).filter((item) => isPublicListingVisible(item as any));

  return (
    <SellerClient
      initialProfile={profile}
      initialListings={listings}
    />
  );
}
