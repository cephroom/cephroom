import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `stripe` is server-only and pulls in Node built-ins. Keeping it external
  // stops Turbopack trying to bundle it.
  serverExternalPackages: ["stripe"],

  /**
   * Contract 1's logging audit, configured rather than merely asserted.
   *
   * Next logs every incoming request and every Server Function call — the
   * latter including its arguments — to the terminal in development. Neither
   * carries an identity today, but "no request logging" is a claim this
   * project makes in docs/CONTRACTS.md, and a claim that depends on nobody
   * ever passing a subject into a server action is not much of a claim.
   *
   * Both are development-only in Next, so this changes nothing in production.
   * It is set so that the default is the contract's default too.
   */
  logging: {
    incomingRequests: false,
    serverFunctions: false,
  },
};

export default nextConfig;
