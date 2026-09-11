import type { ProviderOption } from "@/components/auth-form";
import { GITHUB_CONFIGURED, GOOGLE_CONFIGURED } from "@/lib/auth";
import { isDevOAuthEnabled } from "@/lib/auth/dev-oauth";

/**
 * The OAuth buttons to show, and whether each one can actually complete.
 * An unconfigured provider is rendered disabled with the reason rather than
 * hidden, so a deployment that is missing credentials says so out loud.
 */
export function authProviderOptions(): ProviderOption[] {
  const options: ProviderOption[] = [
    {
      id: "google",
      label: "Continue with Google",
      configured: GOOGLE_CONFIGURED,
      icon: "google",
    },
    {
      id: "github",
      label: "Continue with GitHub",
      configured: GITHUB_CONFIGURED,
      icon: "github",
    },
  ];

  if (isDevOAuthEnabled()) {
    options.push({
      id: "dev-oauth",
      label: "Continue with local dev SSO",
      configured: true,
      icon: "local",
    });
  }

  return options;
}

/** Rejects absolute and protocol-relative URLs as post-auth destinations. */
export function safeCallback(raw: string | undefined): string {
  if (!raw) return "/columns";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/columns";
}
