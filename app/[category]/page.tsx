import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import CategoryClient from "./CategoryClient";
import { listCollection, normTRAscii, runQueryByField } from "@/lib/firestoreRest";
import { buildListingPath, slugifyTR } from "@/lib/listingUrl";

export const revalidate = 300;
export const runtime = "nodejs";

type CategoryDoc = {
  id: string;
  name: string;
  nameLower?: string;
  slug?: string;
  parentId?: string | null;
  enabled?: boolean;
};

type SubCategoryDoc = {
  id: string;
  name: string;
  nameLower?: string;
  parentId?: string | null;
  enabled?: boolean;
};

type ListingDoc = {
  id?: string;
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

const LISTINGS_BATCH = 60;

const matchesCategoryKey = (
  key: string,
  rawKey: string,
  doc: { id?: string; slug?: string; nameLower?: string; name?: string }
) => {
  const normKeys = [doc.id, doc.slug, doc.nameLower, doc.name].map((x) =>
    normTRAscii(String(x || ""))
  );
  const slugKeys = [doc.slug, doc.nameLower, doc.name].map((x) =>
    slugifyTR(String(x || ""))
  );
  return normKeys.includes(key) || slugKeys.includes(rawKey);
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }> | { category: string };
}): Promise<Metadata> {
  const resolved = await params;
  const categorySlug = resolved.category ? decodeURIComponent(resolved.category) : "";
  const categoriesAll = await listCollection<CategoryDoc>("categories");
  const categories = categoriesAll.filter(
    (c) => !c.parentId && c.enabled !== false
  );
  const key = normTRAscii(categorySlug);
  const slugKey = slugifyTR(categorySlug);
  const match = categories.find((c) => matchesCategoryKey(key, slugKey, c));

  if (!match) {
    return {
      title: "Kategori bulunamadı",
      robots: { index: false, follow: false },
    };
  }

  const canonicalSlug = slugifyTR(match.slug || match.nameLower || match.name);
  const title = `${match.name} | İlanlar`;
  const listingsForMeta = await runQueryByField<ListingDoc>({
    collectionId: "listings",
    fieldPath: "categoryId",
    value: match.id,
    limit: 6,
  });

  const extraMeta = buildListingMeta(listingsForMeta);
  const description = clampMeta(
    `${match.name} kategorisindeki ilanları keşfet. Uygun fiyatlar ve hızlı iletişim. ${extraMeta}`.trim()
  );
  const fallbackOg = `${siteUrl}/${encodeURIComponent(canonicalSlug)}/opengraph-image`;
  const ogImage =
    listingsForMeta.find((l) => Array.isArray(l.imageUrls) && l.imageUrls[0])
      ?.imageUrls?.[0] || fallbackOg;

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
      images: [
        {
          url: ogImage,
          alt: `${match.name} kategorisi`,
        },
      ],
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
  const categoriesAll = await listCollection<CategoryDoc>("categories");
  const categories = categoriesAll.filter(
    (c) => !c.parentId && c.enabled !== false
  );
  const key = normTRAscii(categorySlug);
  const slugKey = slugifyTR(categorySlug);
  const match = categories.find((c) => matchesCategoryKey(key, slugKey, c));

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

  const subCategories = categoriesAll
    .filter((s) => !!s.parentId && s.parentId === match.id && s.enabled !== false)
    .map((s) => ({
      id: s.id,
      name: s.name,
      nameLower: s.nameLower || normTRAscii(s.name),
      categoryId: s.parentId || undefined,
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

  const breadcrumbJson = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Ana Sayfa",
        item: siteUrl,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: match.name,
        item: `${siteUrl}/${encodeURIComponent(canonicalSlug)}`,
      },
    ],
  };

  const itemListItems = listings.filter((l) => !!l.id).slice(0, 10);
  const itemListJson = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: itemListItems.map((l, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: l.title || "İlan",
      url: `${siteUrl}${buildListingPath(l.id || "", l.title)}`,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([breadcrumbJson, itemListJson]),
        }}
      />
      <CategoryClient
        initialCategory={category}
        initialSubCategories={subCategories}
        initialListings={listings}
        initialHasMore={listings.length === LISTINGS_BATCH}
      />
    </>
  );
}
