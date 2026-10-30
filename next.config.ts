import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Proxy playlist-worker endpoints so the app works both through the
  // gateway (XTransformPort) and when accessed directly on the Next port.
  async rewrites() {
    return [
      {
        source: "/pw/:path*",
        destination: "http://127.0.0.1:3030/pw/:path*",
      },
    ];
  },
};

export default nextConfig;
