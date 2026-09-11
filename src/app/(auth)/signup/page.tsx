import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { register, signInWithProvider } from "@/app/(auth)/actions";
import { AuthForm } from "@/components/auth-form";
import { auth } from "@/lib/auth";
import { authProviderOptions, safeCallback } from "@/lib/auth/providers";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const params = await searchParams;
  const session = await auth();
  if (session?.user) redirect(safeCallback(params.callbackUrl));

  return (
    <AuthForm
      mode="signup"
      action={register}
      providerAction={signInWithProvider}
      providers={authProviderOptions()}
      callbackUrl={safeCallback(params.callbackUrl)}
    />
  );
}
