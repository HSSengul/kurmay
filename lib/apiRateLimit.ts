import "server-only";
import { createHash } from "crypto";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export type RateLimitResult = {
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

function normalizeIpToken(raw: string) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  const withoutBrackets = trimmed.replace(/^\[|\]$/g, "");
  const withoutPort = withoutBrackets.replace(/:\d+$/, "");
  return withoutPort.slice(0, 120);
}

export function getRequestIp(request: Request) {
  const candidates = [
    request.headers.get("cf-connecting-ip") || "",
    request.headers.get("x-vercel-forwarded-for") || "",
    request.headers.get("x-forwarded-for") || "",
    request.headers.get("x-real-ip") || "",
  ];

  for (const candidate of candidates) {
    const first = String(candidate).split(",")[0] || "";
    const normalized = normalizeIpToken(first);
    if (normalized) return normalized;
  }
  return "unknown";
}

export function getRequestFingerprint(request: Request) {
  const ip = getRequestIp(request);
  const ua = (request.headers.get("user-agent") || "").slice(0, 180);
  const hash = createHash("sha256")
    .update(`${ip}|${ua}`)
    .digest("hex")
    .slice(0, 24);
  return `${ip}:${hash}`;
}

function checkLocalRateLimit(
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

async function checkUpstashRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!url || !token) return null;

  const now = Date.now();
  const slot = Math.floor(now / windowMs);
  const redisKey = `rl:${key}:${slot}`;
  const ttlSec = Math.max(1, Math.ceil(windowMs / 1000) + 2);

  try {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", redisKey],
        ["EXPIRE", redisKey, String(ttlSec)],
      ]),
      cache: "no-store",
    });
    if (!res.ok) return null;

    const data = (await res.json()) as Array<{ result?: unknown }>;
    const count = Number(data?.[0]?.result);
    if (!Number.isFinite(count) || count <= 0) return null;

    const remaining = Math.max(0, limit - count);
    const retryAfterSec = Math.max(
      1,
      Math.ceil((windowMs - (now % windowMs)) / 1000)
    );
    return {
      allowed: count <= limit,
      remaining,
      retryAfterSec: count <= limit ? 0 : retryAfterSec,
    };
  } catch {
    return null;
  }
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const distributed = await checkUpstashRateLimit(key, limit, windowMs);
  if (distributed) return distributed;
  return checkLocalRateLimit(key, limit, windowMs);
}
