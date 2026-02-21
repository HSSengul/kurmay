import { NextResponse } from "next/server";
import { checkRateLimit, getRequestIp } from "@/lib/apiRateLimit";

export const runtime = "nodejs";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 60;

export async function GET(request: Request) {
  const ip = getRequestIp(request);
  const rate = checkRateLimit(
    `reverse-geocode:${ip}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      {
        status: 429,
        headers: {
          "Retry-After": String(rate.retryAfterSec),
          "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  const { searchParams } = new URL(request.url);
  const latRaw = (searchParams.get("lat") || "").trim();
  const lngRaw = (searchParams.get("lng") || "").trim();

  const lat = Number(latRaw);
  const lng = Number(lngRaw);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { ok: false, error: "invalid_coords" },
      { status: 400 }
    );
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json(
      { ok: false, error: "coords_out_of_range" },
      { status: 400 }
    );
  }

  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(
    String(lat)
  )}&lon=${encodeURIComponent(String(lng))}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "kutukafa/1.0 (reverse-geocode)",
        "Accept-Language": "tr-TR",
      },
      next: { revalidate: 60 * 60 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: "reverse_failed" },
        { status: 502 }
      );
    }

    const data = (await res.json()) as {
      display_name?: string;
    };

    const label = String(data?.display_name || "").trim();
    if (!label) {
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      label,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "reverse_exception" },
      { status: 500 }
    );
  }
}
