"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { AuthFormState } from "@/app/(auth)/actions";

export interface ProviderOption {
  id: string;
  label: string;
  configured: boolean;
  icon: "google" | "github" | "local";
}

export function AuthForm({
  mode,
  action,
  providerAction,
  providers,
  callbackUrl,
}: {
  mode: "signin" | "signup";
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  providerAction: (formData: FormData) => Promise<void>;
  providers: ProviderOption[];
  callbackUrl: string;
}) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(action, {});
  const isSignup = mode === "signup";

  return (
    <div className="w-full max-w-[24rem]">
      <h1 className="font-serif text-[1.75rem] font-semibold tracking-[-0.02em]">
        {isSignup ? "Create your account" : "Sign in"}
      </h1>
      <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-muted">
        {isSignup
          ? "Free to read the open columns. Upgrade whenever you want the rest."
          : "Welcome back."}
      </p>

      <div className="mt-7 space-y-2.5">
        {providers.map((provider) => (
          <form key={provider.id} action={providerAction}>
            <input type="hidden" name="provider" value={provider.id} />
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <ProviderButton provider={provider} />
          </form>
        ))}
      </div>

      <div className="my-6 flex items-center gap-3 text-[0.72rem] uppercase tracking-[0.09em] text-ink-faint">
        <span className="h-px flex-1 bg-rule" />
        or
        <span className="h-px flex-1 bg-rule" />
      </div>

      <form action={formAction} className="space-y-3.5" noValidate>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />

        {isSignup && (
          <Field
            label="Name"
            name="name"
            type="text"
            autoComplete="name"
            invalid={state.field === "name"}
          />
        )}

        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          invalid={state.field === "email"}
        />

        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={isSignup ? "new-password" : "current-password"}
          hint={isSignup ? "At least 10 characters." : undefined}
          invalid={state.field === "password"}
        />

        {state.error && (
          <p
            role="alert"
            className="rounded-md border border-broken/30 bg-broken-wash px-3 py-2 text-[0.82rem] text-broken"
          >
            {state.error}
          </p>
        )}

        <SubmitButton label={isSignup ? "Create account" : "Sign in"} />
      </form>

      <p className="mt-6 text-[0.85rem] text-ink-muted">
        {isSignup ? "Already have an account? " : "New here? "}
        <Link
          href={
            isSignup
              ? `/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`
              : `/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`
          }
          className="font-medium text-accent hover:underline"
        >
          {isSignup ? "Sign in" : "Create one"}
        </Link>
      </p>
    </div>
  );
}

function ProviderButton({ provider }: { provider: ProviderOption }) {
  const { pending } = useFormStatus();

  if (!provider.configured) {
    return (
      <span
        className="flex w-full cursor-not-allowed items-center justify-center gap-2.5 rounded-md border border-rule bg-paper-sunken px-4 py-2.5 text-[0.88rem] font-medium text-ink-faint"
        title={`Set AUTH_${provider.id.toUpperCase()}_ID and AUTH_${provider.id.toUpperCase()}_SECRET to enable this.`}
      >
        <ProviderIcon icon={provider.icon} />
        {provider.label}
        <span className="text-[0.72rem] font-normal">not configured</span>
      </span>
    );
  }

  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center justify-center gap-2.5 rounded-md border border-rule-strong bg-paper-raised px-4 py-2.5 text-[0.88rem] font-medium text-ink transition-colors hover:border-ink-faint disabled:opacity-60"
    >
      <ProviderIcon icon={provider.icon} />
      {provider.label}
    </button>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-accent px-4 py-2.5 text-[0.9rem] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
    >
      {pending ? "Working…" : label}
    </button>
  );
}

function Field({
  label,
  name,
  type,
  autoComplete,
  hint,
  invalid,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete: string;
  hint?: string;
  invalid?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.8rem] font-medium text-ink-muted">
        {label}
      </span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        aria-invalid={invalid || undefined}
        className={`w-full rounded-md border bg-paper-raised px-3 py-2 text-[0.92rem] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent ${
          invalid ? "border-broken" : "border-rule-strong"
        }`}
      />
      {hint && <span className="mt-1 block text-[0.75rem] text-ink-faint">{hint}</span>}
    </label>
  );
}

function ProviderIcon({ icon }: { icon: ProviderOption["icon"] }) {
  if (icon === "google") {
    return (
      <svg viewBox="0 0 18 18" className="h-4 w-4" aria-hidden>
        <path
          fill="#4285F4"
          d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
        />
        <path
          fill="#FBBC05"
          d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.96H.96a9 9 0 0 0 0 8.08l3.01-2.32z"
        />
        <path
          fill="#EA4335"
          d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.32C4.68 5.16 6.66 3.58 9 3.58z"
        />
      </svg>
    );
  }
  if (icon === "github") {
    return (
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 text-accent" aria-hidden>
      <rect
        x="2.5"
        y="6.5"
        width="11"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
      />
      <path
        d="M5.5 6.5V4.75a2.5 2.5 0 0 1 5 0V6.5"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
      />
    </svg>
  );
}
