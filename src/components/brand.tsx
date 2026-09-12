import Link from "next/link";


const ARMS =
  "M13.53 8.3Q15.37 7.04 17.62 7.03" +
  "M15.7 10.47Q17.89 10.88 19.49 12.46" +
  "M15.7 13.53Q16.96 15.37 16.97 17.62" +
  "M13.53 15.7Q13.12 17.89 11.54 19.49" +
  "M10.47 15.7Q8.63 16.96 6.38 16.97" +
  "M8.3 13.53Q6.11 13.12 4.51 11.54" +
  "M8.3 10.47Q7.04 8.63 7.03 6.38" +
  "M10.47 8.3Q10.88 6.11 12.46 4.51";

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

export function CephroomMark({
  className = "",
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
      {}
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
