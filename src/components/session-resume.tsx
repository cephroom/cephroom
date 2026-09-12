"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

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
