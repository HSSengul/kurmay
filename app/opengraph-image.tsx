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
            "linear-gradient(135deg, #fff7ed 0%, #f6efe5 50%, #f4e4d2 100%)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          color: "#3f2a1a",
          fontFamily: "Arial, sans-serif",
          padding: 80,
          boxSizing: "border-box",
        }}
      >
        <div style={{ fontSize: 60, fontWeight: 700, marginBottom: 24 }}>
          İlanSitesi
        </div>
        <div style={{ fontSize: 28, color: "#7a5a40", textAlign: "center" }}>
          Kutu oyunu, figür, koleksiyon ve daha fazlası
        </div>
      </div>
    ),
    size
  );
}
