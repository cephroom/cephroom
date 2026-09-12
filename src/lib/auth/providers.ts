import { isDevOAuthEnabled } from "@simulated/google/provider";


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
  profile(raw: Record<string, unknown>): { accountId: string };
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
      scope: "openid profile",
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // The account id and nothing else. No email, because the scope is not
      // requested; no display name, because a name the platform learns is a
      // name it can pass on, and it did — into every key, and from there onto
      // a contributor's disk. Not reading it is stronger than discarding it.
      profile: (raw) => ({ accountId: String(raw.sub ?? "") }),
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
      profile: (raw) => ({ accountId: String(raw.id ?? "") }),
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
      // Matches the Google scope, so the development flow exercises the same
      // shape of answer rather than a richer one.
      scope: "openid profile",
      clientId: "cephroom-local",
      clientSecret: "cephroom-local-secret",
      profile: (raw) => ({ accountId: String(raw.sub ?? "") }),
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

export function safeNext(raw: string | null | undefined): string {
  if (!raw) return "/read";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/read";
}
