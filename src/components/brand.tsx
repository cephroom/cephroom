import Link from "next/link";

/**
 * The identity, and the argument it makes.
 *
 * An octopus keeps roughly two thirds of its half-billion neurons in its
 * eight arms rather than in its brain. An arm tastes, decides and reaches on
 * its own; the centre coordinates and does not command. That is not a
 * metaphor we chose for the name — it is this platform's architecture stated
 * in biology. Columns and datasets live in the contributors' nodes, every
 * claim is judged in the reader's browser, and the platform in the middle
 * holds a lease and an address and nothing else.
 *
 * So the mark is drawn to say that: a small hollow centre, and eight arms
 * each ending in a solid ganglion. The mass is at the edges, deliberately and
 * visibly. If someone ever proposes moving the intelligence inward, the
 * logo stops being true.
 *
 * Everything here is drawn from arithmetic — eight arms on 45° centres,
 * curled 26°, tips at r=7.5, ganglia at r=9.55 — and not traced from
 * anything.
 */

/**
 * The eight arms: from r=4.0 to r=7.5, curled 26°.
 *
 * Drawn thin and half-transparent on purpose. At 23px in the header, eight
 * strokes plus eight dots plus a ring is more shape than 23px can hold, and
 * the first draft collapsed into an orange pinwheel — distinctive, but the
 * idea was gone. Letting the arms recede makes the small size read as what it
 * should: a ring of eight solid nodes around a small hollow centre.
 */
const ARMS =
  "M13.53 8.3Q15.37 7.04 17.62 7.03" +
  "M15.7 10.47Q17.89 10.88 19.49 12.46" +
  "M15.7 13.53Q16.96 15.37 16.97 17.62" +
  "M13.53 15.7Q13.12 17.89 11.54 19.49" +
  "M10.47 15.7Q8.63 16.96 6.38 16.97" +
  "M8.3 13.53Q6.11 13.12 4.51 11.54" +
  "M8.3 10.47Q7.04 8.63 7.03 6.38" +
  "M10.47 8.3Q10.88 6.11 12.46 4.51";

/**
 * A ganglion past each arm tip, at r=9.55. These carry the weight of the
 * mark, because they carry the weight of the argument: two thirds of an
 * octopus's neurons are out here, not in the middle.
 */
const GANGLIA: ReadonlyArray<readonly [number, number]> = [
  [19.53, 6.12],
  [21.48, 13.16],
  [17.88, 19.53],
  [10.84, 21.48],
  [4.47, 17.88],
  [2.52, 10.84],
  [6.12, 4.47],
  [13.16, 2.52],
];

/**
 * The mark. Reads as a glyph at 20 px and as a diagram at 64 px.
 *
 * `currentColor` throughout so a single colour utility drives it, with the
 * ganglia optionally taking the counterpart hue where there is room for two.
 */
export function CephroomMark({
  className = "",
  /**
   * Draw the centre in the counterpart hue.
   *
   * The mass — arms and ganglia — always takes the primary. Colouring the
   * periphery as the secondary was the first attempt and it argued the
   * opposite of the point: the edges are the main thing here, so the edges
   * get the main colour, and the small hollow middle is the one that differs.
   */
  duotone = false,
}: {
  className?: string;
  duotone?: boolean;
}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d={ARMS}
        stroke="currentColor"
        strokeWidth="1.05"
        strokeLinecap="round"
        opacity="0.62"
      />
      <g fill="currentColor">
        {GANGLIA.map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" />
        ))}
      </g>
      {/* The centre: small, hollow, and outnumbered. */}
      <circle
        cx="12"
        cy="12"
        r="2.85"
        strokeWidth="1.4"
        className={duotone ? "stroke-counter" : "stroke-[currentColor]"}
      />
    </svg>
  );
}

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-2 text-ink"
      aria-label="Cephroom home"
    >
      <CephroomMark duotone className="h-[23px] w-[23px] text-accent transition-transform duration-300 group-hover:rotate-[22.5deg] motion-reduce:transition-none motion-reduce:group-hover:rotate-0" />
      <span className="font-serif text-[1.32rem] font-semibold leading-none tracking-[-0.02em]">
        Cephroom
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------ *
 * The same idea at diagram size
 * ------------------------------------------------------------------ */

/**
 * The architecture, drawn once, at a size where it can be labelled.
 *
 * Each arm is a contributor's node; the ganglion at its tip is where the
 * columns, the datasets and the judging actually happen. The ring at the
 * centre is the platform: a lease and an address, drawn hollow because there
 * is nothing inside it. The dashed spans are a reader fetching bytes straight
 * from an arm — past the middle, not through it.
 *
 * Original work: the geometry is the same arithmetic as the mark, scaled.
 */
export function DistributedFigure({ className = "" }: { className?: string }) {
  const arms = GANGLIA.map(([cx, cy]) => ({
    cx: (cx - 12) * 4 + 60,
    cy: (cy - 12) * 4 + 60,
  }));

  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      role="img"
      aria-label="Eight contributor nodes arranged around a small hollow centre. Each node carries its own store of work; the centre holds only a lease and an address."
    >
      <g transform="translate(60 60) scale(4) translate(-12 -12)">
        <path
          d={ARMS}
          stroke="currentColor"
          strokeWidth="0.4"
          strokeLinecap="round"
          opacity="0.5"
        />
      </g>
      {arms.map(({ cx, cy }) => (
        <circle
          key={`${cx}-${cy}`}
          cx={cx}
          cy={cy}
          r="5.5"
          className="fill-accent"
        />
      ))}
      <circle
        cx="60"
        cy="60"
        r="11.4"
        fill="none"
        strokeWidth="1.6"
        strokeDasharray="3 2.4"
        className="stroke-counter"
      />
    </svg>
  );
}
