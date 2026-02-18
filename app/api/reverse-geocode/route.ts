import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
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
