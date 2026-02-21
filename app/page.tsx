import HomeClient from "./HomeClient";
import { listCollection, runActiveCollectionQuery } from "@/lib/firestoreRest";

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
        "status",
        "attributes",
      ],
    }),
  ]);

  return (
    <HomeClient initialCategories={categories} initialListings={listings} />
  );
}
