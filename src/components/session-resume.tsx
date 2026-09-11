"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Silently resumes a session on cold load.
 *
 * Rendered only when the access key has lapsed but a refresh cookie is
 * present. It calls the refresh endpoint once — which re-asks Stripe and
 * mints a fresh access key — then re-renders the tree so the header comes
 * back signed in. A returning member within the refresh window never sees a
 * spurious signed-out state or has to click sign-in again.
 */
export function SessionResume() {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      const response = await fetch("/api/auth/refresh", {
        method: "POST",
      }).catch(() => null);
      // Only reload if the refresh actually signed us in, to avoid a loop
      // when the refresh key turns out to be expired too.
      if (response?.ok) {
        const json = (await response.json().catch(() => null)) as {
          signedIn?: boolean;
        } | null;
        if (json?.signedIn) router.refresh();
      }
    })();
  }, [router]);

  return null;
}
