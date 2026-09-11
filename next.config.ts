import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `stripe` and `@libsql/client` are server-only and pull in Node built-ins.
  // Keeping them external stops Turbopack from trying to bundle them.
  serverExternalPackages: ["stripe", "@libsql/client", "bcryptjs"],
};

export default nextConfig;
