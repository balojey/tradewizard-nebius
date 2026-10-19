import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'static-assets.artlogic.net',
      },
    ],
  },
};

export default nextConfig;
