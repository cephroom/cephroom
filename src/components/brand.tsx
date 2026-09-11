import Link from "next/link";

/**
 * The mark is a binding event: a small ligand docked into a pocket.
 * It reads as a glyph at 20px and as a diagram at 64px.
 */
export function ReceptoromeMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M3.25 5.5A2.25 2.25 0 0 1 5.5 3.25h5.25a2 2 0 0 1 0 4h-1.5a2 2 0 0 0 0 4h1.5a2 2 0 0 1 0 4H5.5a2.25 2.25 0 0 1-2.25-2.25z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="17.75" cy="9.25" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 20.75h8.75"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M3.25 20.75h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.4"
      />
    </svg>
  );
}

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-2 text-ink"
      aria-label="Receptorome home"
    >
      <ReceptoromeMark className="h-[22px] w-[22px] text-accent transition-transform group-hover:-rotate-6" />
      <span className="font-serif text-[1.32rem] font-semibold leading-none tracking-[-0.02em]">
        Receptorome
      </span>
    </Link>
  );
}
