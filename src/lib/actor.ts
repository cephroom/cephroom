/**
 * Whether a key was taken for a person or an AI agent - a self-declaration,
 * never a verified fact.
 *
 * This is the one identity distinction the platform carries, and it is carried
 * the only way this design can carry anything about a caller: as a claim SIGNED
 * INTO THE KEY, chosen by whoever asks for the key, checked by nobody. It is not
 * a stored profile (there is no account to attach it to - contract 2), and it is
 * not proven (the platform verifies proofs and produces none, and there is no
 * proof of personhood to verify anyway - contract 8). Anyone can pick either,
 * and the UI says so rather than implying a badge means more than it does
 * (contract 9).
 *
 * It must never gate anything. Reach, entitlement and what a node serves are
 * decided without reference to it; a human and an AI on the same plan get the
 * same key except for this one self-reported word. Treating it as authorization
 * would turn an unverifiable self-claim into a permission, which is the mistake
 * this comment exists to forestall.
 *
 * One source of truth for the symbol and label, so the sign-in page, the
 * pricing page, the account page and the CLI cannot drift into showing
 * different icons for the same thing.
 */
export type ActorKind = "human" | "ai";

export const ACTOR_KINDS: readonly ActorKind[] = ["human", "ai"];

/**
 * Absence means human. An older key with no actor claim, or an unrecognised
 * value, reads as a person - the conservative default, since "AI" is the thing
 * a caller opts into declaring.
 */
export const DEFAULT_ACTOR: ActorKind = "human";

export function asActor(value: unknown): ActorKind {
  return value === "ai" ? "ai" : "human";
}

export interface ActorFace {
  kind: ActorKind;
  /** The full name, e.g. for a radio label. */
  label: string;
  /** The short name, e.g. beside an icon. */
  short: string;
}

/**
 * Names only. The glyph is drawn by <ActorIcon> (src/components/actor-icon.tsx)
 * in the site's own line style - no emoji, which sat badly in serif text and did
 * not theme. One source of truth for the words, one for the mark.
 */
export const ACTOR_FACE: Record<ActorKind, ActorFace> = {
  human: { kind: "human", label: "A person", short: "Person" },
  ai: { kind: "ai", label: "An AI agent", short: "AI agent" },
};

/**
 * The one sentence every surface should use when it shows the choice, so the
 * honesty is stated in the same words everywhere and cannot be softened in one
 * place - contracts 8 and 9.
 */
export const ACTOR_DISCLAIMER =
  "You choose this; nothing checks it. Your key records what you picked, and either is free to take.";
