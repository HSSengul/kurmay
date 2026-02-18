import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();

  if (!q) {
    return NextResponse.json(
      { ok: false, error: "missing_query" },
      { status: 400 }
    );
  }

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
    q
  )}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "kutukafa/1.0 (geocode)",
        "Accept-Language": "tr-TR",
      },
      next: { revalidate: 60 * 60 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: "geocode_failed" },
        { status: 502 }
      );
    }

    const data = (await res.json()) as Array<{
      lat: string;
      lon: string;
      display_name?: string;
    }>;

    if (!Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const lat = Number(data[0].lat);
    const lng = Number(data[0].lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json(
        { ok: false, error: "invalid_coords" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      lat,
      lng,
      label: data[0].display_name || q,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "geocode_exception" },
      { status: 500 }
    );
  }
}
