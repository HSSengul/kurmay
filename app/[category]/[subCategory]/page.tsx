import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import SubCategoryClient from "./SubCategoryClient";
import { listCollection, normTRAscii, runQueryByField } from "@/lib/firestoreRest";
import { slugifyTR } from "@/lib/listingUrl";

export const revalidate = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CategoryDoc = {
  id: string;
  name: string;
  nameLower?: string;
  slug?: string;
  parentId?: string | null;
};

type SubCategoryDoc = {
  id: string;
  name: string;
  nameLower?: string;
  slug?: string;
  categoryId?: string;
  parentId?: string | null;
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
  params: Promise<{ category: string; subCategory: string }> | { category: string; subCategory: string };
}): Promise<Metadata> {
  const resolved = await params;
  const categorySlug = resolved.category ? decodeURIComponent(resolved.category) : "";
  const subCategorySlug = resolved.subCategory
    ? decodeURIComponent(resolved.subCategory)
    : "";

  const categories = await listCollection<CategoryDoc>("categories");
  const subCategories = await listCollection<SubCategoryDoc>("subCategories");
  const subCategoriesFallback: SubCategoryDoc[] = categories
    .filter((c) => !!c.parentId)
    .map((c) => ({
      id: c.id,
      name: c.name,
      nameLower: c.nameLower,
      slug: c.slug,
      categoryId: c.parentId || undefined,
      parentId: c.parentId || undefined,
    }));

  const categoryKey = normTRAscii(categorySlug);
  const matchCategory = categories.find((c) => {
    const keys = [c.id, c.slug, c.nameLower, c.name].map((x) =>
      normTRAscii(String(x || ""))
    );
    return keys.includes(categoryKey);
  });
  if (!matchCategory) {
    return {
      title: "Kategori bulunamadı",
      robots: { index: false, follow: false },
    };
  }

  const subKey = normTRAscii(subCategorySlug);
  const matchSub =
    subCategories.find((s) => {
      if ((s.categoryId || s.parentId) !== matchCategory.id) return false;
      const keys = [s.id, s.slug, s.nameLower, s.name].map((x) =>
        normTRAscii(String(x || ""))
      );
      return keys.includes(subKey);
    }) ||
    subCategoriesFallback.find((s) => {
      if (s.parentId !== matchCategory.id) return false;
      const keys = [s.id, s.slug, s.nameLower, s.name].map((x) =>
        normTRAscii(String(x || ""))
      );
      return keys.includes(subKey);
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
  const description = clampMeta(
    `${matchCategory.name} › ${matchSub.name} ilanlarını keşfet.`
  );
  const ogImage = `${siteUrl}/opengraph-image`;

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

  const categories = await listCollection<CategoryDoc>("categories");
  const subCategoriesAll = await listCollection<SubCategoryDoc>("subCategories");
  const subCategoriesFallback: SubCategoryDoc[] = categories
    .filter((c) => !!c.parentId)
    .map((c) => ({
      id: c.id,
      name: c.name,
      nameLower: c.nameLower,
      slug: c.slug,
      categoryId: c.parentId || undefined,
      parentId: c.parentId || undefined,
    }));

  const categoryKey = normTRAscii(categorySlug);
  const matchCategory = categories.find((c) => {
    const keys = [c.id, c.slug, c.nameLower, c.name].map((x) =>
      normTRAscii(String(x || ""))
    );
    return keys.includes(categoryKey);
  });
  if (!matchCategory) notFound();

  const subKey = normTRAscii(subCategorySlug);
  const matchSub =
    subCategoriesAll.find((s) => {
      if ((s.categoryId || s.parentId) !== matchCategory.id) return false;
      const keys = [s.id, s.slug, s.nameLower, s.name].map((x) =>
        normTRAscii(String(x || ""))
      );
      return keys.includes(subKey);
    }) ||
    subCategoriesFallback.find((s) => {
      if (s.parentId !== matchCategory.id) return false;
      const keys = [s.id, s.slug, s.nameLower, s.name].map((x) =>
        normTRAscii(String(x || ""))
      );
      return keys.includes(subKey);
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
    categoryId: (matchSub as any).categoryId || (matchSub as any).parentId || matchCategory.id,
  };

  const subCategoriesSource = subCategoriesAll.length
    ? subCategoriesAll
    : subCategoriesFallback;

  const subCategories = subCategoriesSource
    .filter((s) => (s.categoryId || s.parentId) === matchCategory.id)
    .map((s) => ({
      id: s.id,
      name: s.name,
      nameLower: s.nameLower || normTRAscii(s.name),
      categoryId: (s as any).categoryId || (s as any).parentId,
    }))
    .sort((a, b) =>
      (a.nameLower || a.name).localeCompare(b.nameLower || b.name, "tr")
    );

  const listings = await runQueryByField<ListingDoc>({
    collectionId: "listings",
    fieldPath: "subCategoryId",
    value: matchSub.id,
    orderByField: "createdAt",
    direction: "DESCENDING",
    limit: LISTINGS_BATCH,
  });

  return (
    <SubCategoryClient
      initialCategory={category}
      initialSubCategory={subCategory}
      initialSubCategories={subCategories}
      initialListings={listings}
      initialHasMore={listings.length === LISTINGS_BATCH}
    />
  );
}
