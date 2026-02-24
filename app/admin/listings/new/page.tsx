"use client";

import { NewListingPageClient } from "@/app/new/page";

export default function AdminNewListingPage() {
  return <NewListingPageClient adminMode cancelHref="/admin/listings" />;
}

