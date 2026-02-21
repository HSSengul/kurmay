"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminSubCategoriesRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/categories");
  }, [router]);

  return null;
}
