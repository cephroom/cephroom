import type { Metadata } from "next";
import Link from "next/link";

import { DistributedFigure } from "@/components/brand";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "The claim syntax, and the two constraints that everything else follows from.",
};

const CLAIM_EXAMPLE = `Haloperidol binds the human D2 receptor with a median Ki
of {{claim:hal-d2}}, pooled across {{claim:hal-d2-docs}}
independent publications.

\`\`\`claim hal-d2
dataset: receptorome-ki
metric:  median_ki_nm
subject: DRD2
object:  haloperidol
scope:   all
value:   1.549 nM
tolerance: 10%
\`\`\``;

const METHOD_EXAMPLE = `\`\`\`claim tcnet-online
dataset: mi-decoders-2025
metric:  accuracy_pct
subject: EEG-TCNet
object:  four-class-motor-imagery
method:  online
value:   70.0 %
tolerance: 2%
\`\`\``;

export default function HowItWorksPage() {
  return (
    <main className="mx-auto max-w-[46rem] px-5 py-12 sm:py-16">
      <header className="border-b border-rule pb-8">
        <h1 className="font-serif text-[2.1rem] font-semibold tracking-[-0.025em] sm:text-[2.6rem]">
          How it works
        </h1>
        <p className="mt-3 text-[1.05rem] leading-relaxed text-ink-muted">
          A Cephroom column is Markdown with one extra idea in it: an author
          never types a measured number. They write the query that produces it,
          and record what that query returned when they wrote the sentence.
        </p>
      </header>

      <div className="prose mt-10">
        <h2>The problem this solves</h2>
        <p>
          A review article is a snapshot. The databases underneath it are not.
          ChEMBL ships a release every few months; a value that was a median of
          fourteen measurements in 2021 is a median of thirty-one now, and
          sometimes the median moves. The prose does not. Nobody re-reads a
          four-year-old review against the current data, so a literature
          slowly accumulates sentences that were true once.
        </p>
        <p>
          Software solved this, not with better writing, but with continuous
          integration. Cephroom applies the same mechanism to the numbers in
          prose — except that here the check runs in your browser, on the way
          in, every time.
        </p>

        <h2>The syntax</h2>
        <p>
          Two constructs. An inline reference where the number belongs, and a
          fenced block that says what that number is.
        </p>
      </div>

      <pre
          className="scroll-x mt-6 overflow-x-auto rounded-xl border border-rule bg-paper-sunken p-5 font-mono text-[0.8rem] leading-relaxed"
          role="group"
          aria-label="Example - scroll to see more"
          tabIndex={0}
        >
        {CLAIM_EXAMPLE}
      </pre>

      <div className="prose mt-10">
        <p>
          The <code>value:</code>{" "}
          line is never displayed. It exists so that
          something can be compared against — and the comparison happens on
          your machine, against a dataset fetched from whoever is serving it,
          a few hundred milliseconds before you read the sentence.
        </p>

        <h3>What a claim can assert</h3>
        <p>
          A claim does not have to be a median. The <code>select:</code>{" "}
          line
          chooses what the cell is asked for:
        </p>
        <ul>
          <li>
            <code>value</code>{" "}
            (the default) — the median the query resolves
            to, in the metric&rsquo;s own unit.
          </li>
          <li>
            <code>n_points</code> / <code>n_docs</code> — how many measurements,
            or how many independent papers, stand behind the cell.
          </li>
          <li>
            <code>fold_spread</code> — the full fold spread, the loosest
            measurement over the tightest. A claim about how far the labs
            disagree.
          </li>
          <li>
            <code>fold_spread_iqr</code> — the same, but across the middle half
            of the measurements, ignoring outliers. This is a claim about how
            well the labs <em>agree</em>, which a median hides completely: a
            cell can carry a tidy median on top of a hundred-fold total spread.
          </li>
          <li>
            <code>censored_fraction</code> — what share of the cell&rsquo;s
            measurements are censored ceilings (a <code>&gt;</code>{" "}
            bound)
            rather than real values. Written as <code>0.07</code>{" "}
            or{" "}
            <code>7%</code>. A claim about how much of the median rests on true
            data.
          </li>
          <li>
            <code>pdsp_fold</code> — how far this number sits from the{" "}
            <em>independent</em>{" "}
            PDSP Ki Database&rsquo;s median for the same
            target and compound, as a fold ratio. Near <code>1×</code>{" "}
            means a
            second, separate database reproduces the number — the strongest
            check there is.
          </li>
          <li>
            <code>method_spread</code> — how far the <em>analyses</em>{" "}
            of the same data disagree: the widest value over the narrowest,
            across every pipeline the dataset holds for that cell. Not the same
            as <code>fold_spread</code>, which is about laboratories. A large
            number means the result is a property of how it was computed.
          </li>
        </ul>

        <h3>Naming the analysis</h3>
        <p>
          A median Ki is computed one way, so a binding cell has one value. A
          decoding accuracy, a cluster-corrected activation, a spectral peak is
          a property of <em>a pipeline applied to data</em> — change the
          evaluation protocol or the smoothing kernel and the number moves.
          Where a dataset holds the same cell under more than one analysis, a
          claim says which one it means:
        </p>
        <pre>
          <code>{METHOD_EXAMPLE}</code>
        </pre>
        <p>
          <strong>There is no default.</strong>{" "}
          Leave <code>method:</code>{" "}
          out on a cell with several analyses and the claim resolves{" "}
          <em>broken</em>, naming the analyses that exist. Not a warning and not
          a pooled average — both are slower ways of not being told, and the
          average is a number no experiment produced.
        </p>
        <p>
          That is deliberate, and taken from evidence rather than taste.
          NeuroVault&rsquo;s collection schema carries about sixty fields
          describing the analysis pipeline, added years before seventy teams
          analysed one fMRI dataset and reported significant effects for
          anywhere between 0% and 100% of the hypotheses depending on how they
          did it. On those teams&rsquo; own submitted maps, ten of 107 fields
          are filled and none of them is an analysis field. Optional provenance
          is not collected. The only version that survives a deadline is the
          one where the number does not come out without it.
        </p>
        <p>
          A fold value is a bare ratio — <code>5.07x</code>,{" "}
          <code>5.07-fold</code>{" "}
          and <code>5.07</code>{" "}
          are the same assertion —
          and renders as <code>5.07×</code>. Where a cell has too few
          measurements to have an interquartile range at all, an{" "}
          <code>fold_spread_iqr</code>{" "}
          claim on it resolves to{" "}
          <em>broken</em>{" "}
          rather than borrowing a looser number: you cannot
          honestly assert agreement you do not have the data to measure.
        </p>
      </div>

      <div className="mt-6 space-y-3">
        <Verdict tone="verified" name="Verified">
          Within the tolerance the author set. The sentence still says what it
          said.
        </Verdict>
        <Verdict tone="drifted" name="Drifted">
          Both values exist and differ by more than the tolerance. The number
          on the page is the current one; the argument around it may no longer
          follow.
        </Verdict>
        <Verdict tone="broken" name="Broken">
          The query did not resolve — the cell is gone, the unit no longer
          matches, or nobody is serving the dataset it needs. A unit mismatch
          is deliberately broken rather than drifted:{" "}
          <code className="font-mono">1.55 nM</code>{" "}
          against{" "}
          <code className="font-mono">1.55 µM</code>{" "}
          is not a 0% drift, it is a
          question nothing here is allowed to answer by guessing a conversion.
        </Verdict>
      </div>

      {}
      <div id="contracts" className="prose mt-14 scroll-mt-20">
        <h2>The two constraints</h2>
        <p>
          Most of what this platform does not do is not an omission. Two rules
          are held to absolutely, and nearly every other design decision is a
          consequence of them.
        </p>

        <h3>1. Nothing about you is kept</h3>
        <p>
          There is no user table, no profile, no session store, and no copy of
          your subscription. You sign in with Google to prove who you are;
          nothing is written as a result. You receive a signed key stating your
          plans and what they permit, and every check after that is a signature
          verification rather than a lookup.
        </p>
        <p>What follows, whether convenient or not:</p>
        <ul>
          <li>
            Your plan is read from Stripe when the key is issued and at every
            renewal, because Stripe is the only party permitted to remember
            anything.
          </li>
          <li>
            <strong>Keys cannot be revoked.</strong>{" "}
            Revocation needs a
            blocklist and a blocklist is state. They last fifteen minutes and
            renew quietly, so a cancellation reaches you within fifteen
            minutes. A stolen renewal key is good for seven days and there is
            no way to invalidate it short of rotating the signing key, which
            signs everybody out. That is a real weakness, and it is stated
            rather than hidden behind &ldquo;short-lived tokens&rdquo;.
          </li>
          <li>
            There is no password, because a password is something we would have
            to store.
          </li>
          <li>
            No request logging that retains identity, no analytics, no error
            reporter. The platform never reads your IP address.
          </li>
        </ul>

        <h3>2. Nothing anyone writes is kept either</h3>
        <p>
          A contributor&rsquo;s work lives on their own machine. They run a
          node; it announces an id, a title and an address; your browser
          fetches the bytes from theirs. The platform brokers and holds no
          copy, so there is nothing for it to cache, censor, or keep serving
          after the author has stopped.
        </p>

        <figure className="not-prose my-9 rounded-xl border border-rule bg-paper-sunken px-5 py-7">
          <DistributedFigure className="mx-auto h-44 w-44 text-ink-faint" />
          <figcaption className="mx-auto mt-5 max-w-[34rem] text-center text-[0.85rem] leading-relaxed text-ink-muted">
            An octopus keeps about two thirds of its half-billion neurons in
            its arms rather than its brain; an arm tastes and decides without
            asking. That is the shape of this platform, and the reason for its
            name. Each node out there holds the columns, the datasets and the
            evidence. The ring in the middle holds a lease and an address —
            drawn hollow because there is nothing inside it.
          </figcaption>
        </figure>
        <p>What follows:</p>
        <ul>
          <li>
            <strong>There is no archive.</strong>{" "}
            You cannot cite a column and
            expect it next year. If nobody will serve it, nobody is standing
            behind it.
          </li>
          <li>
            Discovery is presence. Search reaches what is online, because an
            index of everything would be a copy of everything.
          </li>
          <li>
            An offline contributor is absent, and the page you land on cannot
            even name what used to be there — a helpful tombstone would mean
            the platform had kept the title.
          </li>
          <li>
            Claims are checked in your browser rather than on a schedule, so a
            green verdict can never be three weeks stale.
          </li>
        </ul>

        <h3>Where they bend</h3>
        <p>
          Five places, all recorded. The platform holds a presence registry in
          memory, because otherwise discovery cannot exist at all. It keeps a
          set of spent-token markers, because a blind signature cannot stop the
          same token being spent twice unless something remembers that it was —
          opaque hashes, no person attached, dropped within two hours. That one
          is a real weakening of &ldquo;we store nothing&rdquo; and is{" "}
          <Link href="/privacy">set out in full</Link>{" "}
          rather than folded into this sentence. Stripe holds
          real personal data, because someone must hold a payment relationship.
          A simulated Stripe writes a file in development, because live keys
          need a bank account. And a contributor&rsquo;s node writes to their
          own disk, which is the entire point.
        </p>
        <p>
          Each is bounded, and the bound is a test rather than a promise: see{" "}
          <a
            href="https://github.com/cephroom/cephroom/blob/main/tests/contracts"
            target="_blank"
            rel="noopener noreferrer"
          >
            tests/contracts
          </a>{" "}
          for the one that holds each. The registry has to forget; the
          spent-marker set has to be a
          structure with no room for a payload; the simulated Stripe has to
          stay inside its own directory. Features that were built and then cut
          are named there too, so that reaching for one again means reading
          why it went.
        </p>

        <h2>What this does not do</h2>
        <p>
          It checks against the author&rsquo;s own data. The dataset a claim is
          resolved against is served from the same machine as the column, by the
          same person. So a green check means the sentence is consistent with
          the data its author stands behind and is current with it &mdash; not
          that either the number or the data is independently correct. What it
          removes is the case where a figure has quietly drifted from the
          author&rsquo;s own source; what it gives everyone else is the data in
          the open, to check for themselves. That is worth having and it is not
          the same as being right.
        </p>
        <p>
          It does not check reasoning. A column can be entirely green and still
          draw a conclusion the numbers do not support. Checked claims remove
          the silent-rot class of error and leave every other class where it
          was.
        </p>
        <p>
          It does not improve the underlying data. Some cells rest on a single
          measurement from a single paper. Those cells are checkable and still
          thin, which is why every claim carries its evidence count beside its
          value.
        </p>
      </div>

      <div className="mt-12 rounded-xl border border-rule bg-paper-sunken p-6">
        <h2 className="font-serif text-[1.2rem] font-semibold">
          Want to publish one?
        </h2>
        <p className="mt-2 max-w-[52ch] text-[0.9rem] leading-relaxed text-ink-muted">
          There is no upload and no account. You run a node, and your work is
          discoverable for exactly as long as you serve it.
        </p>
        <Link
          href="/contribute"
          className="mt-4 inline-block rounded-md bg-accent px-5 py-2.5 text-[0.88rem] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
        >
          Run a node
        </Link>
      </div>
    </main>
  );
}

const VERDICT_TONE = {
  verified: "border-verified/30 bg-verified-wash text-verified",
  drifted: "border-drifted/30 bg-drifted-wash text-drifted",
  broken: "border-broken/30 bg-broken-wash text-broken",
} as const;

const DOT_TONE = {
  verified: "bg-verified",
  drifted: "bg-drifted",
  broken: "bg-broken",
} as const;

function Verdict({
  tone,
  name,
  children,
}: {
  tone: keyof typeof VERDICT_TONE;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-rule bg-paper-raised p-5">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.76rem] font-medium ${VERDICT_TONE[tone]}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${DOT_TONE[tone]}`} aria-hidden />
        {name}
      </span>
      <p className="mt-2.5 text-[0.9rem] leading-relaxed text-ink-muted">
        {children}
      </p>
    </div>
  );
}
