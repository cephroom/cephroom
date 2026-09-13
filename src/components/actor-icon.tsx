import type { ActorKind } from "@/lib/actor";

/**
 * Line-art marks for the two actor kinds, drawn to sit with the site's own
 * iconography rather than an emoji dropped into serif text.
 *
 * Stroke is currentColor at a constant weight, so a caller sets the colour and
 * size from context (accent when selected, muted otherwise) and the glyph
 * inherits it. No fill, no baked palette - the same reason the verdict marks are
 * characters and not coloured dots: the shape carries the meaning, the colour
 * only reinforces it.
 */
export function ActorIcon({
  kind,
  size = 20,
  className,
}: {
  kind: ActorKind;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {kind === "human" ? (
        <>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
        </>
      ) : (
        <>
          {/* an antenna, a squared head, two eyes and a base line - a machine,
              read at a glance, in the same line weight as the person mark. */}
          <path d="M12 3v2.5" />
          <circle cx="12" cy="2.5" r="0.6" fill="currentColor" stroke="none" />
          <rect x="5" y="5.5" width="14" height="11" rx="2.5" />
          <path d="M9.5 11v1.5M14.5 11v1.5" />
          <path d="M9 20h6" />
          <path d="M12 16.5V20" />
        </>
      )}
    </svg>
  );
}
