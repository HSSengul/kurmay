import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "linear-gradient(135deg, #fff7ed 0%, #f6efe5 45%, #efe0d0 100%)",
          display: "flex",
          justifyContent: "flex-start",
          alignItems: "flex-start",
          color: "#3f2a1a",
          fontFamily: "Arial, sans-serif",
          padding: 64,
          boxSizing: "border-box",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -120,
            top: -80,
            width: 380,
            height: 380,
            borderRadius: 9999,
            background: "rgba(217, 162, 108, 0.18)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 80,
            bottom: -140,
            width: 320,
            height: 320,
            borderRadius: 9999,
            background: "rgba(111, 79, 50, 0.12)",
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            maxWidth: 900,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 9999,
                background: "#d28b50",
              }}
            />
            <div style={{ fontSize: 58, fontWeight: 800, letterSpacing: -1 }}>
              İlanSitesi
            </div>
          </div>
          <div style={{ fontSize: 30, color: "#6f4f32", lineHeight: 1.3 }}>
            Kutu oyunu, figür, koleksiyon ve daha fazlası
          </div>
          <div style={{ fontSize: 22, color: "#8a6b52" }}>
            Güvenli alışveriş · Hızlı iletişim · Güncel ilanlar
          </div>
          <div
            style={{
              display: "flex",
              padding: "10px 18px",
              borderRadius: 9999,
              background: "#3f2a1a",
              color: "#fff",
              fontSize: 20,
              fontWeight: 600,
              width: "fit-content",
            }}
          >
            + İlan Ver
          </div>
        </div>
      </div>
    ),
    size
  );
}
