"use server";

import { AuthError } from "next-auth";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { signIn } from "@/lib/auth";
import { checkPassword, hashPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export interface AuthFormState {
  error?: string;
  field?: "email" | "password" | "name";
}

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("That is not an email address."),
  password: z.string().min(1, "Enter your password."),
});

const registration = credentials.extend({
  name: z.string().trim().min(1, "Tell us what to call you.").max(80),
});

/**
 * Derives a URL-safe handle from a display name, with a numeric suffix if it
 * is already taken. Handles are cosmetic here, so a collision is not worth
 * asking the reader to resolve during sign-up.
 */
async function allocateHandle(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "reader";

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await db.query.users.findFirst({
      where: eq(users.handle, candidate),
    });
    if (!taken) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

export async function signInWithPassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error: issue.message,
      field: issue.path[0] as AuthFormState["field"],
    };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: readCallback(formData),
    });
  } catch (error) {
    // signIn signals a successful redirect by throwing; only AuthError is
    // an actual failure.
    if (error instanceof AuthError) {
      return { error: "That email and password do not match an account." };
    }
    throw error;
  }

  return {};
}

export async function register(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = registration.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error: issue.message,
      field: issue.path[0] as AuthFormState["field"],
    };
  }

  const weak = checkPassword(parsed.data.password);
  if (weak) return { error: weak.message, field: "password" };

  const existing = await db.query.users.findFirst({
    where: eq(users.email, parsed.data.email),
  });
  if (existing) {
    return {
      error: "An account already uses that email. Sign in instead.",
      field: "email",
    };
  }

  await db.insert(users).values({
    name: parsed.data.name,
    email: parsed.data.email,
    handle: await allocateHandle(parsed.data.name),
    passwordHash: await hashPassword(parsed.data.password),
    role: "reader",
  });

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: readCallback(formData),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Account created, but sign-in failed. Try signing in." };
    }
    throw error;
  }

  return {};
}

export async function signInWithProvider(formData: FormData) {
  const provider = String(formData.get("provider") ?? "");
  await signIn(provider, { redirectTo: readCallback(formData) });
}

/** Only same-site paths are accepted as a post-sign-in destination. */
function readCallback(formData: FormData): string {
  const raw = String(formData.get("callbackUrl") ?? "");
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/columns";
}
