import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import CategoryClient from "./CategoryClient";
import { listCollection, normTRAscii, runQueryByField } from "@/lib/firestoreRest";
import { slugifyTR } from "@/lib/listingUrl";

export const revalidate = 300;
export const runtime = "nodejs";

type CategoryDoc = {
  id: string;
  name: string;
  nameLower?: string;
  slug?: string;
};

type SubCategoryDoc = {
  id: string;
  name: string;
  nameLower?: string;
  categoryId?: string;
};

type ListingDoc = {
  title?: string;
  price?: number;
  categoryId?: string;
  categoryName?: string;
  subCategoryId?: string;
  subCategoryName?: string;
  imageUrls?: string[];
  createdAt?: any;
};

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";

const clampMeta = (v: string, max = 160) => {
  const t = (v || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t;
};

const LISTINGS_BATCH = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }> | { category: string };
}): Promise<Metadata> {
  const resolved = await params;
  const categorySlug = resolved.category ? decodeURIComponent(resolved.category) : "";
  const categories = await listCollection<CategoryDoc>("categories");
  const key = normTRAscii(categorySlug);
  const match = categories.find((c) => {
    const keys = [c.id, c.slug, c.nameLower, c.name].map((x) =>
      normTRAscii(String(x || ""))
    );
    return keys.includes(key);
  });

  if (!match) {
    return {
      title: "Kategori bulunamadı",
      robots: { index: false, follow: false },
    };
  }

  const canonicalSlug = slugifyTR(match.slug || match.nameLower || match.name);
  const title = `${match.name} | İlanlar`;
  const description = clampMeta(
    `${match.name} kategorisindeki güncel ilanları keşfet.`
  );
  const ogImage = `${siteUrl}/opengraph-image`;

  return {
    title,
    description,
    alternates: {
      canonical: `${siteUrl}/${encodeURIComponent(canonicalSlug)}`,
    },
    openGraph: {
      title,
      description,
      url: `${siteUrl}/${encodeURIComponent(canonicalSlug)}`,
      images: [{ url: ogImage }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }> | { category: string };
}) {
  const resolved = await params;
  const categorySlug = resolved.category ? decodeURIComponent(resolved.category) : "";
  const categories = await listCollection<CategoryDoc>("categories");
  const key = normTRAscii(categorySlug);
  const match = categories.find((c) => {
    const keys = [c.id, c.slug, c.nameLower, c.name].map((x) =>
      normTRAscii(String(x || ""))
    );
    return keys.includes(key);
  });

  if (!match) notFound();

  const canonicalSlug = slugifyTR(match.slug || match.nameLower || match.name);
  const currentSlug = slugifyTR(categorySlug);
  if (canonicalSlug && currentSlug && canonicalSlug !== currentSlug) {
    permanentRedirect(`/${canonicalSlug}`);
  }

  const category = {
    id: match.id,
    name: match.name,
    nameLower: match.nameLower || normTRAscii(match.name),
  };

  const subCategoriesAll = await listCollection<SubCategoryDoc>("subCategories");
  const subCategories = subCategoriesAll
    .filter((s) => s.categoryId === match.id)
    .map((s) => ({
      id: s.id,
      name: s.name,
      nameLower: s.nameLower || normTRAscii(s.name),
      categoryId: s.categoryId,
    }))
    .sort((a, b) =>
      (a.nameLower || a.name).localeCompare(b.nameLower || b.name, "tr")
    );

  const listings = await runQueryByField<ListingDoc>({
    collectionId: "listings",
    fieldPath: "categoryId",
    value: match.id,
    orderByField: "createdAt",
    direction: "DESCENDING",
    limit: LISTINGS_BATCH,
  });

  return (
    <CategoryClient
      initialCategory={category}
      initialSubCategories={subCategories}
      initialListings={listings}
      initialHasMore={listings.length === LISTINGS_BATCH}
    />
  );
}
