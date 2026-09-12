import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `stripe` is server-only and pulls in Node built-ins. Keeping it external
  // stops Turbopack trying to bundle it.
  serverExternalPackages: ["stripe"],

  logging: {
    incomingRequests: false,
    serverFunctions: false,
  },
};

export default nextConfig;
