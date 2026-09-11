import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import { db } from "@/lib/db";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from "@/lib/db/schema";
import { devOAuthProvider, isDevOAuthEnabled } from "@/lib/auth/dev-oauth";
import { verifyPassword } from "@/lib/auth/password";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      handle?: string | null;
      role?: string | null;
    } & DefaultSession["user"];
  }
}

export const GOOGLE_CONFIGURED = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);
export const GITHUB_CONFIGURED = Boolean(
  process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET,
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  // JWT rather than database sessions, because the Credentials provider
  // cannot use the adapter session store. Entitlements are never read from
  // the token - they are queried fresh in src/lib/entitlements.ts - so a
  // subscription change takes effect on the next request, not the next login.
  session: { strategy: "jwt" },
  trustHost: true,
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
    ...(isDevOAuthEnabled() ? [devOAuthProvider()] : []),
    Credentials({
      id: "credentials",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const email = String(raw?.email ?? "")
          .trim()
          .toLowerCase();
        const password = String(raw?.password ?? "");
        if (!email || !password) return null;

        const user = await db.query.users.findFirst({
          where: eq(users.email, email),
        });
        if (!user?.passwordHash) return null;

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user?.id) token.sub = user.id;

      // Refresh the display fields on sign-in and on an explicit update(),
      // so a profile edit shows up without forcing a re-login.
      if (user || trigger === "update") {
        const record = token.sub
          ? await db.query.users.findFirst({ where: eq(users.id, token.sub) })
          : undefined;
        if (record) {
          token.name = record.name;
          token.email = record.email ?? undefined;
          token.picture = record.image ?? undefined;
          token.handle = record.handle ?? undefined;
          token.role = record.role;
        }
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      session.user.handle = (token.handle as string | undefined) ?? null;
      session.user.role = (token.role as string | undefined) ?? "reader";
      return session;
    },
  },
});
