import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "The claim syntax, the check runner, and what each verdict means.",
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
\`\`\`

\`\`\`claim hal-d2-docs
dataset: receptorome-ki
metric:  median_ki_nm
subject: DRD2
object:  haloperidol
select:  n_docs
value:   93
tolerance: 5%
\`\`\``;

export default function HowItWorksPage() {
  return (
    <main className="mx-auto max-w-[46rem] px-5 py-12 sm:py-16">
      <header className="border-b border-rule pb-8">
        <h1 className="font-serif text-[2.1rem] font-semibold tracking-[-0.025em] sm:text-[2.6rem]">
          How it works
        </h1>
        <p className="mt-3 text-[1.05rem] leading-relaxed text-ink-muted">
          A Bindery column is Markdown with one extra idea in it: an author
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
          four-year-old review against the current data, and so a literature
          slowly accumulates sentences that were true once.
        </p>
        <p>
          Software solved this, not with better writing, but with continuous
          integration: every change re-runs every test, and a regression
          announces itself. Bindery applies the same mechanism to the numbers in
          prose.
        </p>

        <h2>The syntax</h2>
        <p>
          Two constructs. An inline reference where the number belongs, and a
          fenced block that says what that number is.
        </p>
      </div>

      <pre className="scroll-x mt-6 overflow-x-auto rounded-xl border border-rule bg-paper-sunken p-5 font-mono text-[0.8rem] leading-relaxed">
        {CLAIM_EXAMPLE}
      </pre>

      <div className="prose mt-10">
        <p>
          The reader gets the value the dataset holds <em>now</em>, rendered at
          read time, with a coloured dot carrying the verdict of the last check
          run. The <code>value:</code> line is never displayed — it exists so
          that CI has something to compare against.
        </p>

        <h3>Fields</h3>
      </div>

      <div className="mt-5 overflow-x-auto rounded-xl border border-rule">
        <table className="w-full text-[0.85rem]">
          <thead>
            <tr className="border-b border-rule bg-paper-sunken text-left">
              <Th>Field</Th>
              <Th>Required</Th>
              <Th>Meaning</Th>
            </tr>
          </thead>
          <tbody>
            <Field name="dataset" required>
              The dataset slug the query resolves against. Pins the claim to a
              named snapshot at a named upstream release.
            </Field>
            <Field name="metric" required>
              Which measurement, e.g. <code>median_ki_nm</code> or{" "}
              <code>median_pki</code>.
            </Field>
            <Field name="subject" required>
              The row of the matrix. For the receptorome dataset, a target gene
              symbol.
            </Field>
            <Field name="object" required>
              The column of the matrix. For the receptorome dataset, a compound
              name.
            </Field>
            <Field name="scope">
              <code>all</code> or <code>human</code>. Which assay organisms the
              cell was computed over. Defaults to <code>all</code>.
            </Field>
            <Field name="select">
              <code>value</code>, <code>n_points</code> or <code>n_docs</code>.
              Lets a sentence assert the amount of evidence rather than the
              value. Defaults to <code>value</code>.
            </Field>
            <Field name="value">
              What the author observed, with its unit. Without it the claim is{" "}
              <strong>broken</strong>: there is nothing to check against.
            </Field>
            <Field name="tolerance">
              How much drift the author will accept. <code>10%</code> for a
              linear metric; a bare number like <code>0.15</code> for an
              absolute tolerance, which is what a log-scale metric such as pKi
              needs. Defaults to <code>10%</code>.
            </Field>
          </tbody>
        </table>
      </div>

      <div className="prose mt-10">
        <h2>The verdicts</h2>
      </div>

      <div className="mt-5 space-y-3">
        <Verdict tone="verified" name="Verified">
          The dataset value is within the tolerance the author set. The sentence
          still says what it said.
        </Verdict>
        <Verdict tone="drifted" name="Drifted">
          Both values exist and differ by more than the tolerance. The number on
          the page is the current one; the argument around it may no longer
          follow. The column carries an amber badge and the author gets it in
          their queue.
        </Verdict>
        <Verdict tone="broken" name="Broken">
          The query no longer resolves — a renamed target, a cell that has
          emptied, a unit that no longer matches. Deliberately the same verdict
          as a unit mismatch: <code className="font-mono">1.55 nM</code> against{" "}
          <code className="font-mono">1.55 µM</code> is not a 0% drift, it is a
          question the runner is not allowed to answer by guessing a conversion.
        </Verdict>
      </div>

      <div className="prose mt-10">
        <h2>When checks run</h2>
        <ul>
          <li>
            <strong>On publish.</strong> A column cannot go out with a claim
            that does not resolve.
          </li>
          <li>
            <strong>On demand.</strong> Any author can re-run their own column.
          </li>
          <li>
            <strong>On a dataset release.</strong> Re-importing a dataset bumps
            its version and re-runs every claim in every column that cites it.
            This is the one that matters: it is the moment a four-year-old
            sentence finds out it is wrong.
          </li>
        </ul>

        <h2>What it does not do</h2>
        <p>
          It does not check reasoning. A column can have every claim green and
          still draw a conclusion the numbers do not support — the{" "}
          <Link href="/columns/serotonin-dopamine-ratio-audited">
            5-HT2A:D2 piece
          </Link>{" "}
          is partly about exactly that failure. Checked claims remove one class
          of error, the silent-rot class, and leave every other class where it
          was.
        </p>
        <p>
          It also does not make the underlying data better. The receptorome
          matrix has cells resting on a single measurement from a single paper.
          Those cells are checkable and still thin, which is why every claim
          carries its evidence count alongside its value.
        </p>
      </div>

      <div className="mt-12 rounded-xl border border-rule bg-paper-sunken p-6">
        <h2 className="font-serif text-[1.2rem] font-semibold">
          Want to write one?
        </h2>
        <p className="mt-2 max-w-[52ch] text-[0.9rem] leading-relaxed text-ink-muted">
          The studio has a live preview that resolves your claims as you type
          and tells you which ones would fail before you publish.
        </p>
        <Link
          href="/studio"
          className="mt-4 inline-block rounded-md bg-accent px-5 py-2.5 text-[0.88rem] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          Open the studio
        </Link>
      </div>
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-[0.72rem] font-semibold uppercase tracking-[0.06em] text-ink-faint">
      {children}
    </th>
  );
}

function Field({
  name,
  required,
  children,
}: {
  name: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <tr className="border-b border-rule align-top last:border-0">
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[0.8rem]">
        {name}
      </td>
      <td className="px-4 py-2.5 text-[0.8rem] text-ink-faint">
        {required ? "yes" : "no"}
      </td>
      <td className="px-4 py-2.5 leading-relaxed text-ink-muted">{children}</td>
    </tr>
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
