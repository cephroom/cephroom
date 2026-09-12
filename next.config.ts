import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["stripe"],

  logging: {
    incomingRequests: false,
    serverFunctions: false,
  },
};

export default nextConfig;
