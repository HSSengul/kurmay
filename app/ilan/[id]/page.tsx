import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import ListingDetailClient from "./ListingDetailClient";
import { fetchDocument } from "@/lib/firestoreRest";
import { buildListingPath, extractListingId } from "@/lib/listingUrl";
import { serializeJsonLd } from "@/lib/serializeJsonLd";

export const revalidate = 300;
export const runtime = "nodejs";

type ListingDoc = {
  title: string;
  description?: string;
  price: number;
  categoryId?: string;
  categoryName?: string;
  subCategoryId?: string;
  subCategoryName?: string;
  brandId?: string;
  brandName?: string;
  modelId?: string;
  modelName?: string;
  imageUrls?: string[];
  conditionKey?: "new" | "likeNew" | "good" | "used" | "forParts" | "pnp" | "";
  conditionLabel?: string;
  isTradable?: boolean;
  shippingAvailable?: boolean;
  createdAt?: any;
  ownerId: string;
};

type PublicProfileDoc = {
  name?: string;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  websiteInstagram?: string;
  phone?: string;
  email?: string;
  address?: string;
  showPhone?: boolean;
  showAddress?: boolean;
  showWebsiteInstagram?: boolean;
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}): Promise<Metadata> {
  const resolved = await params;
  const rawId = resolved.id || "";
  const listingId = extractListingId(rawId);
  const listing = await fetchDocument<ListingDoc>("listings", listingId);
  if (!listing) {
    return {
      title: "İlan bulunamadı",
      robots: { index: false, follow: false },
    };
  }

  const titleBase = listing.title || "İlan";
  const category = listing.categoryName || listing.brandName || "";
  const subCategory = listing.subCategoryName || listing.modelName || "";
  const title = [titleBase, category, subCategory]
    .filter(Boolean)
    .join(" | ");

  const conditionText = listing.conditionLabel || listing.conditionKey || "";
  const priceText = Number.isFinite(Number(listing.price))
    ? `Fiyat: ${formatPriceTRY(listing.price)}.`
    : "";
  const extraBits = [conditionText ? `Durum: ${conditionText}.` : "", priceText]
    .filter(Boolean)
    .join(" ");
  const context = [category, subCategory].filter(Boolean).join(" / ");
  const baseDescription =
    listing.description?.trim() ||
    `${titleBase}${context ? ` | ${context}` : ""} ilanı.`;
  const description = clampMeta(
    `${baseDescription} ${extraBits} Hemen incele, güvenli alışveriş ve hızlı iletişim.`.trim()
  );

  const canonicalPath = buildListingPath(listingId, titleBase);
  const ogImage = Array.isArray(listing.imageUrls) ? listing.imageUrls[0] : "";
  const fallbackOg = `${siteUrl}${canonicalPath}/opengraph-image`;

  return {
    title,
    description,
    alternates: {
      canonical: `${siteUrl}${canonicalPath}`,
    },
    openGraph: {
      title,
      description,
      url: `${siteUrl}${canonicalPath}`,
      images: [
        {
          url: ogImage || fallbackOg,
          alt: titleBase,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage || fallbackOg],
    },
  };
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const resolved = await params;
  const rawId = resolved.id || "";
  const listingId = extractListingId(rawId);
  const listing = await fetchDocument<ListingDoc>("listings", listingId);
  if (!listing) notFound();

  const canonicalPath = buildListingPath(listingId, listing.title);
  const currentPath = `/ilan/${decodeURIComponent(rawId)}`;
  if (canonicalPath !== currentPath) {
    permanentRedirect(canonicalPath);
  }

  const normalizedListing = {
    ...listing,
    categoryId: listing.categoryId || listing.brandId || "",
    categoryName: listing.categoryName || listing.brandName || "",
    subCategoryId: listing.subCategoryId || listing.modelId || "",
    subCategoryName: listing.subCategoryName || listing.modelName || "",
    conditionKey: listing.conditionKey as
      | ""
      | "new"
      | "likeNew"
      | "good"
      | "used"
      | "forParts"
      | "pnp"
      | undefined,
  };

  const seller = normalizedListing.ownerId
    ? await fetchDocument<PublicProfileDoc>("publicProfiles", normalizedListing.ownerId)
    : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: listing.title,
    description: listing.description || undefined,
    image: Array.isArray(listing.imageUrls) ? listing.imageUrls : undefined,
    category: normalizedListing.categoryName || undefined,
    offers: {
      "@type": "Offer",
      priceCurrency: "TRY",
      price: listing.price,
      availability: "https://schema.org/InStock",
      url: `${siteUrl}${canonicalPath}`,
    },
    seller: seller?.name
      ? {
          "@type": "Person",
          name: seller.name,
        }
      : undefined,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <ListingDetailClient
        initialListing={normalizedListing}
        initialSeller={seller}
      />
    </>
  );
}
