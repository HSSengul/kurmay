import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { unstable_cache } from "next/cache";
import SubCategoryClient from "./SubCategoryClient";
import {
  listCollection,
  normTRAscii,
  runActiveQueryByField,
} from "@/lib/firestoreRest";
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
  slug?: string;
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

const getCategoriesCached = unstable_cache(
  async () => listCollection<CategoryDoc>("categories"),
  ["kf_categories"],
  { revalidate: 300 }
);

const getListingsForSubMeta = unstable_cache(
  async (subId: string) =>
    runActiveQueryByField<ListingDoc>({
      collectionId: "listings",
      fieldPath: "subCategoryId",
      value: subId,
      limit: 6,
    }),
  ["kf_sub_meta_listings"],
  { revalidate: 300 }
);

const LISTINGS_BATCH = 60;

const matchesDocKey = (
  normalizedKey: string,
  slugKey: string,
  doc: { id?: string; slug?: string; nameLower?: string; name?: string }
) => {
  const normKeys = [doc.id, doc.slug, doc.nameLower, doc.name].map((x) =>
    normTRAscii(String(x || ""))
  );
  const slugKeys = [doc.slug, doc.nameLower, doc.name].map((x) =>
    slugifyTR(String(x || ""))
  );
  return normKeys.includes(normalizedKey) || slugKeys.includes(slugKey);
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; subCategory: string }> | { category: string; subCategory: string };
}): Promise<Metadata> {
  const resolved = await params;
  const categorySlug = resolved.category ? decodeURIComponent(resolved.category) : "";
  const subCategorySlug = resolved.subCategory
    ? decodeURIComponent(resolved.subCategory)
    : "";

  const categoriesAll = await getCategoriesCached();
  const categories = categoriesAll.filter(
    (c) => !c.parentId && c.enabled !== false
  );
  const subCategories = categoriesAll
    .filter((c) => !!c.parentId && c.enabled !== false)
    .map((c) => ({
      id: c.id,
      name: c.name,
      nameLower: c.nameLower,
      slug: c.slug,
      parentId: c.parentId || undefined,
      enabled: c.enabled,
    })) as SubCategoryDoc[];

  const categoryKey = normTRAscii(categorySlug);
  const categorySlugKey = slugifyTR(categorySlug);
  const matchCategory = categories.find((c) =>
    matchesDocKey(categoryKey, categorySlugKey, c)
  );
  if (!matchCategory) {
    return {
      title: "Kategori bulunamadı",
      robots: { index: false, follow: false },
    };
  }

  const subKey = normTRAscii(subCategorySlug);
  const subSlugKey = slugifyTR(subCategorySlug);
  const matchSub = subCategories.find((s) => {
    if (s.parentId !== matchCategory.id) return false;
    return matchesDocKey(subKey, subSlugKey, s);
  });
  if (!matchSub) {
    return {
      title: "Alt kategori bulunamadı",
      robots: { index: false, follow: false },
    };
  }

  const canonicalCategorySlug = slugifyTR(
    matchCategory.slug || matchCategory.nameLower || matchCategory.name
  );
  const canonicalSubSlug = slugifyTR(
    matchSub.slug || matchSub.nameLower || matchSub.name
  );
  const title = `${matchSub.name} | ${matchCategory.name}`;

  const listingsForMeta = await getListingsForSubMeta(matchSub.id);

  const extraMeta = buildListingMeta(listingsForMeta);
  const description = clampMeta(
    `${matchCategory.name} / ${matchSub.name} ilanları. Uygun fiyatlar, hızlı iletişim, güvenli alışveriş. ${extraMeta}`.trim()
  );
  const fallbackOg = `${siteUrl}/${encodeURIComponent(
    canonicalCategorySlug
  )}/${encodeURIComponent(canonicalSubSlug)}/opengraph-image`;
  const ogImage =
    listingsForMeta.find((l) => Array.isArray(l.imageUrls) && l.imageUrls[0])
      ?.imageUrls?.[0] || fallbackOg;

  return {
    title,
    description,
    alternates: {
      canonical: `${siteUrl}/${encodeURIComponent(
        canonicalCategorySlug
      )}/${encodeURIComponent(canonicalSubSlug)}`,
    },
    openGraph: {
      title,
      description,
      url: `${siteUrl}/${encodeURIComponent(
        canonicalCategorySlug
      )}/${encodeURIComponent(canonicalSubSlug)}`,
      images: [
        {
          url: ogImage,
          alt: `${matchCategory.name} / ${matchSub.name}`,
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

export default async function SubCategoryPage({
  params,
}: {
  params: Promise<{ category: string; subCategory: string }> | { category: string; subCategory: string };
}) {
  const resolved = await params;
  const categorySlug = resolved.category ? decodeURIComponent(resolved.category) : "";
  const subCategorySlug = resolved.subCategory
    ? decodeURIComponent(resolved.subCategory)
    : "";

  const categoriesAll = await getCategoriesCached();
  const categories = categoriesAll.filter(
    (c) => !c.parentId && c.enabled !== false
  );
  const subCategoriesAll = categoriesAll
    .filter((c) => !!c.parentId && c.enabled !== false)
    .map((c) => ({
      id: c.id,
      name: c.name,
      nameLower: c.nameLower,
      slug: c.slug,
      parentId: c.parentId || undefined,
      enabled: c.enabled,
    })) as SubCategoryDoc[];

  const categoryKey = normTRAscii(categorySlug);
  const categorySlugKey = slugifyTR(categorySlug);
  const matchCategory = categories.find((c) =>
    matchesDocKey(categoryKey, categorySlugKey, c)
  );
  if (!matchCategory) notFound();

  const subKey = normTRAscii(subCategorySlug);
  const subSlugKey = slugifyTR(subCategorySlug);
  const matchSub = subCategoriesAll.find((s) => {
    if (s.parentId !== matchCategory.id) return false;
    return matchesDocKey(subKey, subSlugKey, s);
  });
  if (!matchSub) notFound();

  const canonicalCategorySlug = slugifyTR(
    matchCategory.slug || matchCategory.nameLower || matchCategory.name
  );
  const canonicalSubSlug = slugifyTR(
    matchSub.slug || matchSub.nameLower || matchSub.name
  );
  const currentCategorySlug = slugifyTR(categorySlug);
  const currentSubSlug = slugifyTR(subCategorySlug);
  if (
    canonicalCategorySlug &&
    canonicalSubSlug &&
    (canonicalCategorySlug !== currentCategorySlug ||
      canonicalSubSlug !== currentSubSlug)
  ) {
    permanentRedirect(`/${canonicalCategorySlug}/${canonicalSubSlug}`);
  }

  const category = {
    id: matchCategory.id,
    name: matchCategory.name,
    nameLower: matchCategory.nameLower || normTRAscii(matchCategory.name),
  };

  const subCategory = {
    id: matchSub.id,
    name: matchSub.name,
    nameLower: matchSub.nameLower || normTRAscii(matchSub.name),
    categoryId: (matchSub as any).parentId || matchCategory.id,
  };

  const subCategories = subCategoriesAll
    .filter((s) => s.parentId === matchCategory.id)
    .map((s) => ({
      id: s.id,
      name: s.name,
      nameLower: s.nameLower || normTRAscii(s.name),
      categoryId: (s as any).parentId || undefined,
    }))
    .sort((a, b) =>
      (a.nameLower || a.name).localeCompare(b.nameLower || b.name, "tr")
    );

  const listings = await runActiveQueryByField<ListingDoc>({
    collectionId: "listings",
    fieldPath: "subCategoryId",
    value: matchSub.id,
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
        name: matchCategory.name,
        item: `${siteUrl}/${encodeURIComponent(canonicalCategorySlug)}`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: matchSub.name,
        item: `${siteUrl}/${encodeURIComponent(
          canonicalCategorySlug
        )}/${encodeURIComponent(canonicalSubSlug)}`,
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
      <SubCategoryClient
        initialCategory={category}
        initialSubCategory={subCategory}
        initialSubCategories={subCategories}
        initialListings={listings}
        initialHasMore={listings.length === LISTINGS_BATCH}
      />
    </>
  );
}
