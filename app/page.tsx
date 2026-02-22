import HomeClient from "./HomeClient";
import { listCollection, runActiveCollectionQuery } from "@/lib/firestoreRest";
import { isPublicListingVisible } from "@/lib/listingVisibility";

export const revalidate = 60;

const LISTINGS_PAGE_SIZE = 60;

export default async function HomePage() {
  const [categories, listings] = await Promise.all([
    listCollection("categories", 500, 5),
    runActiveCollectionQuery({
      collectionId: "listings",
      orderByField: "createdAt",
      direction: "DESCENDING",
      limit: LISTINGS_PAGE_SIZE,
      selectFields: [
        "title",
        "price",
        "categoryId",
        "categoryName",
        "subCategoryId",
        "subCategoryName",
        "ownerId",
        "ownerName",
        "ownerDisplayName",
        "sellerName",
        "locationCity",
        "locationDistrict",
        "imageUrls",
        "createdAt",
        "isTradable",
        "shippingAvailable",
        "isShippable",
        "status",
        "adminStatus",
        "attributes",
      ],
    }),
  ]);
  const visibleListings = listings.filter((item) =>
    isPublicListingVisible(item as any)
  );
  const initialHasMore = listings.length === LISTINGS_PAGE_SIZE;

  return (
    <HomeClient
      initialCategories={categories}
      initialListings={visibleListings}
      initialHasMore={initialHasMore}
    />
  );
}
