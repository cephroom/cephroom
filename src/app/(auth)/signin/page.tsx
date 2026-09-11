import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { signInWithPassword, signInWithProvider } from "@/app/(auth)/actions";
import { AuthForm } from "@/components/auth-form";
import { authProviderOptions, safeCallback } from "@/lib/auth/providers";
import { auth } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const params = await searchParams;
  const session = await auth();
  if (session?.user) redirect(safeCallback(params.callbackUrl));

  return (
    <div className="w-full max-w-[24rem]">
      {params.error && (
        <p
          role="alert"
          className="mb-5 rounded-md border border-broken/30 bg-broken-wash px-3 py-2 text-[0.82rem] text-broken"
        >
          {describeError(params.error)}
        </p>
      )}
      <AuthForm
        mode="signin"
        action={signInWithPassword}
        providerAction={signInWithProvider}
        providers={authProviderOptions()}
        callbackUrl={safeCallback(params.callbackUrl)}
      />
    </div>
  );
}

function describeError(code: string): string {
  switch (code) {
    case "OAuthAccountNotLinked":
      return "That email already has an account created a different way. Sign in with the original method first.";
    case "AccessDenied":
      return "The provider declined the sign-in.";
    case "Configuration":
      return "That provider is not configured on this deployment.";
    default:
      return "Sign-in did not complete. Try again.";
  }
}
