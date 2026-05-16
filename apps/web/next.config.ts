import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // typedRoutes graduated out of experimental in Next 15.x; use top-level.
  typedRoutes: true,
};

export default config;
