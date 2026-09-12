import { z } from "zod";

/**
 * What a node may say about itself.
 *
 * Lifted out of the route handler so the bounds can be tested directly.
 * `payTo`'s cap in particular was written once, inline, and asserted nowhere —
 * deleting it passed the entire contract suite, which is a poor state for the
 * one attacker-controlled string the platform relays to every reader of a
 * column.
 *
 * Note what is *not* here. `sub` is absent by design: it comes from the key,
 * never from the body, so a caller cannot announce under a subject they have
 * not proven they control. And nothing validates the *shape* of `payTo` — see
 * PAY_TO_MAX.
 */

/**
 * The longest payment string a contributor may announce.
 *
 * A length is the only thing the platform is willing to know about this
 * field. It is bounded because it is relayed to every reader and held in
 * memory for the lease, not because anything here understands it: recognising
 * a wallet address would be the first step towards routing to one, and the
 * platform is never a party to what happens next. A wallet, a donation page,
 * an institutional account, or a sentence saying not to bother all have to
 * pass through unread and unchanged.
 *
 * 300 characters fits every one of those with room to spare, and is far short
 * of turning an announcement into a content channel.
 */
export const PAY_TO_MAX = 300;

/**
 * An item, as a node announces it.
 *
 * There is no `access`. A column had one — public, member or lab — and the
 * node withheld most of it from readers whose key did not measure up. That
 * sold a consumer "contributors will treat you better" while the contributor
 * got nothing for it. An older node still sending the field is not an error:
 * zod drops it, and it simply no longer means anything.
 */
export const manifestItemSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  kind: z.enum(["column", "dataset"]),
  tags: z.array(z.string().max(60)).max(20).default([]),
  summary: z.string().max(600).optional(),
  openProposals: z.number().int().min(0).max(100000).optional(),
});

export const announcementSchema = z.object({
  displayName: z.string().min(1).max(120),
  address: z
    .string()
    .url()
    .refine((value) => /^https?:/.test(value), "http(s) only"),
  // Bounded, and otherwise untouched: no trim, no normalisation, no shape
  // check. Each of those is a small step towards understanding the string.
  payTo: z.string().max(PAY_TO_MAX).optional(),
  items: z.array(manifestItemSchema).max(500),
});

export type AnnouncementInput = z.infer<typeof announcementSchema>;
