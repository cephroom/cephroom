import { z } from "zod";


/**
 * Contract 5. The only thing done to a payment string is bounding its length.
 *
 * The moment the platform validates one it has an opinion about which payment
 * methods are real, which is a policy, which is a relationship with a payment
 * network - and that is the first step toward holding funds. So it is relayed
 * byte for byte: leading spaces, a wallet address, a sentence of doubt,
 * whatever is in it.
 *
 * brokers-connections-not-value.test.ts asserts the schema line below carries
 * no .trim(, .toLowerCase(, .regex( or .transform(, and that neither this file
 * nor the registry names a payment network. A cap is not validation: it bounds
 * what a stranger can push through the listing, and nothing else.
 */
export const PAY_TO_MAX = 300;

export const manifestItemSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  kind: z.enum(["column", "dataset"]),
  tags: z.array(z.string().max(60)).max(20).default([]),
  summary: z.string().max(600).optional(),
  openProposals: z.number().int().min(0).max(100000).optional(),
});

/**
 * There is deliberately no access field, and zod strips one if it arrives.
 *
 * An access level on an announced item would be the platform's half of a
 * paywall - somewhere for a tier to be declared and therefore somewhere for a
 * node to check one. a-key-unlocks-nothing.test.ts submits an item carrying
 * access: "member" and asserts it parses successfully AND that the field is
 * absent from the result, so the gate has nowhere to land even if a client
 * starts sending one.
 */
export const announcementSchema = z.object({
  displayName: z.string().min(1).max(120),
  address: z
    .string()
    .url()
    .refine((value) => /^https?:/.test(value), "http(s) only"),
  payTo: z.string().max(PAY_TO_MAX).optional(),
  items: z.array(manifestItemSchema).max(500),
});

export type AnnouncementInput = z.infer<typeof announcementSchema>;

/**
 * The platform is never a serving node, so an announcement naming it is either
 * a mistake or an attempt to aim readers at it - contract 4.
 *
 * Refused rather than relayed. The reader-side defence in fetchWithTimeout
 * already stops the session travelling, but a listing entry that points at the
 * platform is false on its face: nothing is served from here, and handing one
 * out would have the platform advertising itself as the host it says it is not.
 *
 * Compared by origin, so a contributor on the same machine and a different port
 * - the normal development case - is unaffected.
 */
export function isPlatformOrigin(address: string, platform: string): boolean {
  try {
    return new URL(address).origin === new URL(platform).origin;
  } catch {
    return false;
  }
}

export function withinCapacity(
  announcement: AnnouncementInput,
  capacity: number,
): boolean {
  return announcement.items.length <= capacity;
}
