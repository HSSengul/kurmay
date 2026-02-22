export type ListingVisibilityLike = {
  status?: unknown;
  adminStatus?: unknown;
};

const MODERATION_HIDE_SET = new Set(["review", "hidden", "removed"]);

export function normalizeListingStatus(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function isPublicListingVisible(item: ListingVisibilityLike) {
  const status = normalizeListingStatus(item?.status);
  if (status !== "active") return false;

  const adminStatus = normalizeListingStatus(item?.adminStatus || "active");
  if (!adminStatus || adminStatus === "active") return true;
  return !MODERATION_HIDE_SET.has(adminStatus);
}

