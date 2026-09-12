import type { DiscoveryTier } from "@/lib/access";

export function tierOnRenewal(input: {
  fromStripe: DiscoveryTier | null;
  current: DiscoveryTier | null;
}): DiscoveryTier {
  if (input.fromStripe !== null) return input.fromStripe;
  return input.current ?? "browse";
}
