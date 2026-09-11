import { NextResponse } from "next/server";

import { FLOW_COOKIE } from "@/app/api/auth/start/route";
import {
  isConfigured,
  providerById,
  redirectUri,
  safeNext,
  type ProviderConfig,
} from "@/lib/auth/providers";
import { accessCookie, refreshCookie } from "@/lib/auth/session";
import {
  deriveSubject,
  mintAccessKey,
  mintRefreshKey,
  safeEqual,
} from "@/lib/keys/tokens";
import { entitlementFor } from "@/lib/stripe/entitlement";

export const dynamic = "force-dynamic";

/**
 * Completes the flow and mints a key.
 *
 * Contract 1, step 2: nothing is written anywhere as a result of this. No row
 * is created, no session stored, no file touched. The provider's answer is
 * turned into a pseudonymous subject, Stripe is asked what that subject is
 * entitled to, and the result is signed into a key that goes to the browser.
 * The platform then forgets all of it.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const url = new URL(request.url);
  const { provider: providerId } = await context.params;

  const provider = providerById(providerId);
  if (!provider || !isConfigured(provider)) {
    return fail(url.origin, "unconfigured");
  }

  const raw = request.headers
    .get("cookie")
    ?.split("; ")
    .find((part) => part.startsWith(`${FLOW_COOKIE}=`))
    ?.slice(FLOW_COOKIE.length + 1);

  if (!raw) return fail(url.origin, "expired");

  let flow: { p: string; s: string; v: string; n: string };
  try {
    flow = JSON.parse(decodeURIComponent(raw));
  } catch {
    return fail(url.origin, "expired");
  }

  const state = url.searchParams.get("state") ?? "";
  if (flow.p !== providerId || !safeEqual(flow.s, state)) {
    return fail(url.origin, "state");
  }

  const code = url.searchParams.get("code");
  if (!code) return fail(url.origin, "denied");

  let accountId: string;
  let name: string;
  try {
    const accessToken = await exchange(provider, code, flow.v);
    const profile = await fetchProfile(provider, accessToken);
    accountId = profile.accountId;
    name = profile.name;
  } catch {
    // Deliberately not logged. An auth failure that recorded who failed
    // would be exactly the identity retention Contract 1 forbids.
    return fail(url.origin, "exchange");
  }

  if (!accountId) return fail(url.origin, "exchange");

  const sub = deriveSubject(providerId, accountId);

  // Ask Stripe, do not remember. If Stripe is unreachable the reader is
  // signed in as a free reader rather than not signed in at all.
  let entitlement;
  try {
    entitlement = await entitlementFor(sub);
  } catch {
    entitlement = { tier: "reader" as const, customerId: null };
  }

  const response = NextResponse.redirect(
    new URL(safeNext(flow.n), url.origin),
    302,
  );

  response.cookies.set(
    accessCookie(
      await mintAccessKey({
        sub,
        tier: entitlement.tier,
        cus: entitlement.customerId ?? undefined,
        name,
      }),
    ),
  );
  response.cookies.set(
    refreshCookie(
      await mintRefreshKey({
        sub,
        cus: entitlement.customerId ?? undefined,
        name,
      }),
    ),
  );
  response.cookies.set({ name: FLOW_COOKIE, value: "", path: "/", maxAge: 0 });

  return response;
}

async function exchange(
  provider: ProviderConfig,
  code: string,
  verifier: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(provider.id),
    client_id: provider.clientId!,
    client_secret: provider.clientSecret!,
    code_verifier: verifier,
  });

  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });

  if (!response.ok) throw new Error("token exchange failed");
  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("no access token");
  return json.access_token;
}

async function fetchProfile(provider: ProviderConfig, accessToken: string) {
  const response = await fetch(provider.userinfoUrl, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "user-agent": "bindery",
    },
  });
  if (!response.ok) throw new Error("userinfo failed");
  return provider.profile((await response.json()) as Record<string, unknown>);
}

function fail(origin: string, reason: string) {
  return NextResponse.redirect(new URL(`/signin?error=${reason}`, origin), 302);
}
