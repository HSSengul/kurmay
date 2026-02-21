type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
};

const getStore = () => {
  const g = globalThis as typeof globalThis & {
    __apiRateLimitStore?: Map<string, RateLimitEntry>;
  };
  if (!g.__apiRateLimitStore) {
    g.__apiRateLimitStore = new Map<string, RateLimitEntry>();
  }
  return g.__apiRateLimitStore;
};

export function getRequestIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const fromForwarded = forwarded.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip") || "";
  const ip = fromForwarded || realIp || "unknown";
  return ip.slice(0, 80);
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const store = getStore();
  const existing = store.get(key);

  if (!existing || now >= existing.resetAt) {
    store.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfterSec: 0,
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  store.set(key, existing);
  return {
    allowed: true,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSec: 0,
  };
}
