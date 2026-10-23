import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Trailing slashes would redirect API calls from Elapsed; keep URLs exact.
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
