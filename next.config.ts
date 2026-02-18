import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
      },
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
    deviceSizes: [360, 480, 640, 800, 1024, 1280],
    imageSizes: [16, 32, 48, 64, 96, 128, 192, 256, 320, 384],
    qualities: [40, 45, 50, 60, 70, 75],
  },
};

export default nextConfig;
