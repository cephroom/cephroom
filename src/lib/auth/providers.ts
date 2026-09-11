import { isDevOAuthEnabled } from "@/lib/auth/dev-oauth";

/**
 * OAuth providers, hand-rolled rather than delegated to a library.
 *
 * Contract 1 requires that signing in writes nothing anywhere. Auth libraries
 * are built around an adapter that persists users, accounts and sessions;
 * even configured not to, they carry the machinery. Implementing the
 * authorization-code flow directly is about 150 lines and makes the
 * "nothing is written" property auditable by reading it.
 */

export interface ProviderConfig {
  id: string;
  label: string;
  icon: "google" | "github" | "local";
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scope: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  /** Pulls a stable account id and display name out of the userinfo payload. */
  profile(raw: Record<string, unknown>): { accountId: string; name: string };
}

function baseUrl(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}

export function providers(): ProviderConfig[] {
  const list: ProviderConfig[] = [
    {
      id: "google",
      label: "Continue with Google",
      icon: "google",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      scope: "openid email profile",
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      profile: (raw) => ({
        accountId: String(raw.sub ?? ""),
        name: String(raw.name ?? raw.email ?? "Reader"),
      }),
    },
    {
      id: "github",
      label: "Continue with GitHub",
      icon: "github",
      authorizeUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      userinfoUrl: "https://api.github.com/user",
      scope: "read:user",
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      profile: (raw) => ({
        accountId: String(raw.id ?? ""),
        name: String(raw.name ?? raw.login ?? "Reader"),
      }),
    },
  ];

  if (isDevOAuthEnabled()) {
    list.push({
      id: "dev-oauth",
      label: "Continue with local dev SSO",
      icon: "local",
      authorizeUrl: `${baseUrl()}/api/dev-oauth/authorize`,
      tokenUrl: `${baseUrl()}/api/dev-oauth/token`,
      userinfoUrl: `${baseUrl()}/api/dev-oauth/userinfo`,
      scope: "openid email profile",
      clientId: "bindery-local",
      clientSecret: "bindery-local-secret",
      profile: (raw) => ({
        accountId: String(raw.sub ?? ""),
        name: String(raw.name ?? "Reader"),
      }),
    });
  }

  return list;
}

export function providerById(id: string): ProviderConfig | null {
  return providers().find((provider) => provider.id === id) ?? null;
}

export function isConfigured(provider: ProviderConfig): boolean {
  return Boolean(provider.clientId && provider.clientSecret);
}

export function redirectUri(providerId: string): string {
  return `${baseUrl()}/api/auth/callback/${providerId}`;
}

/** Rejects absolute and protocol-relative URLs as post-auth destinations. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return "/read";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/read";
}
