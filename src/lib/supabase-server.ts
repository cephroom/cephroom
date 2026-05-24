import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "Missing environment variable NEXT_PUBLIC_SUPABASE_URL. Add it to .env.local.",
    );
  }

  if (!supabaseAnonKey) {
    throw new Error(
      "Missing environment variable NEXT_PUBLIC_SUPABASE_ANON_KEY. Add it to .env.local.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `set` throws when called from a Server Component. Safe to ignore
          // when session refresh is handled by middleware.
        }
      },
    },
  });
}
