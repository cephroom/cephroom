"use client";

import { useFormStatus } from "react-dom";

const VARIANT = {
  primary:
    "bg-accent text-accent-ink hover:bg-accent-hover border border-transparent",
  outline:
    "border border-field-border text-ink hover:border-ink-faint bg-transparent",
  quiet: "border border-transparent text-ink-muted hover:text-ink bg-transparent",
  danger: "border border-broken/40 text-broken hover:bg-broken-wash",
} as const;

export function SubmitButton({
  label,
  pendingLabel,
  variant = "primary",
  name,
  value,
  className = "",
}: {
  label: string;
  pendingLabel?: string;
  variant?: keyof typeof VARIANT;
  name?: string;
  value?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={`rounded-md px-4 py-2.5 text-[0.88rem] font-medium transition-colors disabled:opacity-60 ${VARIANT[variant]} ${className}`}
    >
      {pending ? (pendingLabel ?? "Working…") : label}
    </button>
  );
}
