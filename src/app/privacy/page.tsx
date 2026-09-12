import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "What we can and cannot see",
  description:
    "What Cephroom is structurally unable to learn about you, and — just as plainly — what it and others still can.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-[46rem] px-5 py-12 sm:py-16">
      <header className="border-b border-rule pb-8">
        <h1 className="font-serif text-[2.1rem] font-semibold tracking-[-0.025em] sm:text-[2.6rem]">
          What we can and cannot see
        </h1>
        <p className="mt-3 text-[1.05rem] leading-relaxed text-ink-muted">
          Overclaiming privacy is worse than claiming none, because somebody
          makes a decision on the strength of it. So this page is in two halves,
          and the second half is the one that matters.
        </p>
      </header>

      <div className="prose mt-10">
        <h2>The short version</h2>
        <p>
          <strong>Google knows you signed in here.</strong>{" "}
          That happens on
          Google&rsquo;s servers, before anything reaches us, and no design of
          ours can change it.
        </p>
        <p>
          <strong>Stripe knows you paid, and who you are.</strong>{" "}
          Taking money
          requires a real identity and a real payment relationship. Somebody has
          to hold that, and it cannot be nobody.
        </p>
        <p>
          What the mechanisms below achieve is narrower and worth having:{" "}
          <strong>
            we cannot connect those two facts to what you read.
          </strong>{" "}
          Not &ldquo;we promise not to&rdquo; — we are not able to.
        </p>

        <h2>What we never hold</h2>
        <ul>
          <li>
            No account, profile, display name, avatar, preference or activity
            record. There is no database here at all — no schema, no
            migrations, no ORM in the dependency list.
          </li>
          <li>
            No session store. Your key is a signed statement you carry; we check
            a signature rather than look anything up.
          </li>
          <li>
            No copy of anyone&rsquo;s subscription. Your tier is read from
            Stripe when a key is issued and stamped into it.
          </li>
          <li>
            No request logging that retains identity, no analytics, first- or
            third-party, and no error reporter. We never read your IP address
            from a socket.
          </li>
          <li>
            None of what anybody publishes. A contributor serves their own work
            from their own machine; your browser fetches it from theirs, and we
            are not in that request at all.
          </li>
        </ul>

        <h2>Anonymous search tokens</h2>
        <p>
          Signing in gives us a pseudonymous subject derived from your Google
          account. It is not reversible to an email address, and nothing is
          written down — but it rides along on every query, which means we are{" "}
          <em>capable</em>{" "}
          of associating what you are looking for with your
          subscription, and decline to. What you read we never see at all; what
          you search for we necessarily do, and a few months of somebody&rsquo;s
          queries describes their work before they have published any of it.
          Declining is a promise, and a promise is weaker than an
          impossibility.
        </p>
        <p>
          So paying and searching are severed by arithmetic. When you ask for
          tokens, your browser generates them, multiplies each by a random
          factor that never leaves your machine, and sends us the results. We
          check your subscription and sign. We have signed twelve values we
          cannot read.
        </p>
        <p>
          Later, your browser unblinds a signature into a usable token and
          spends it — with no cookie attached — for a key carrying the reach
          your plan bought and no identity. We cannot tell which subscriber that
          token came from,
          because the only thing that would connect them is the blinding factor,
          and we never had it.
        </p>
        <p>
          This is{" "}
          <a href="https://www.rfc-editor.org/rfc/rfc9578.html">
            Privacy Pass
          </a>
          , an IETF standard, using the publicly verifiable blind RSA token type
          so that anything you present a token to can check it against a public
          key alone. It is not a scheme we invented.
        </p>
        <p>
          You control it from{" "}
          <Link href="/account">your key page</Link>: get tokens, see how many
          this browser is holding, throw them away.
        </p>

        <h2>The one thing we do remember</h2>
        <p>
          A blind signature cannot prevent the same token being spent twice
          unless something remembers that it has been spent. So there is a set
          of spent-token markers, and{" "}
          <strong>
            &ldquo;the platform stores nothing&rdquo; is no longer literally
            true
          </strong>
          . We would rather restate it than let it quietly stop being accurate.
        </p>
        <p>What is in it, exactly:</p>
        <ul>
          <li>
            One opaque 32-byte hash per redeemed token. Not a person, not an
            account, not a column.
          </li>
          <li>
            Nothing else. No time beyond which hour it landed in, no address, no
            browser, no count.
          </li>
          <li>
            It lives in memory and dies with the process, and the signing keys
            rotate hourly — so a marker becomes meaningless within two hours and
            is dropped. The set&rsquo;s size depends on the last two hours of
            traffic, not on all traffic ever.
          </li>
        </ul>
        <p>
          The residual, stated rather than buried: somebody operating this
          server could watch redemptions arrive and count them. They could not
          tell whose they were, nor that two of them came from the same
          subscriber. That is the property the tokens buy, and the limit of it.
        </p>

        <h2>What this still does not hide</h2>
        <p>
          The honest list, because the point of the paragraphs above is that you
          can rely on them, and you can only rely on them if this list is also
          true.
        </p>
        <ul>
          <li>
            <strong>Google knows.</strong>{" "}
            You were redirected to Google and
            back. Google logged it.
          </li>
          <li>
            <strong>Stripe knows.</strong>{" "}
            Your name, email and card are theirs
            and have to be. We never copy any of it back. We ask them for your
            customer id at the moment we need it and let go of it again — it is
            not written down, and it is not in your key either, because a key
            that carried it would be a copy of Stripe&rsquo;s records in the one
            place we had not thought to look.
          </li>
          <li>
            <strong>The contributor sees your network address.</strong>{" "}
            Your
            browser fetches their column from their machine, directly — that is
            the whole architecture, and a direct connection means an IP address
            at the other end. They do not see a name: the key your browser
            presents states a tier and a pseudonymous subject, and for a while
            it also carried the display name Google gave us, which meant
            reading an article told its author who you were. It does not any
            more, and neither does proposing an edit. But a direct connection
            still means an IP address, so an anonymous token stops them
            learning{" "}
            <em>who</em>{" "}
            you are and cannot hide{" "}
            <em>where</em>{" "}
            you are. If that matters to you, a VPN or Tor is the
            answer and we cannot substitute for one.
          </li>
          <li>
            <strong>Page requests still carry your session.</strong>{" "}
            The tokens
            cover what you fetch from a contributor&rsquo;s node. The Cephroom
            page around it is still requested with your cookie attached,
            because that is how a same-site cookie works and because the header
            has to know whether to show your name. So we could, today, see which
            column pages you opened even though we cannot see what you read from
            the node. Narrowing that is the next thing on this list rather than
            something already done, and we are not going to describe it as done.
          </li>
          <li>
            <strong>We still see your Google account id at sign-in.</strong>{" "}
            For about as long as one request takes. We turn it into a one-way
            pseudonymous subject and forget it, and nothing is written down —
            but we hold it, briefly, and a promise is what stops us doing
            otherwise. Removing that needs a zero-knowledge proof that you
            hold a valid Google token without ever showing it to us, and there
            are two reasons you cannot use one here today. They are worth
            separating, because one of them might go away and the other
            cannot.
          </li>
          <li>
            <strong>The first is cost, and it may fall.</strong>{" "}
            We measured it rather than guessing: the circuit is 1.1 million
            constraints, the proving key is about 550 megabytes for your
            browser to download, and proving takes at least half a minute on a
            fast desktop — the people who designed the scheme say it can crash
            a browser outright. Hardware and circuits both improve, so this is
            a number with a date on it.
          </li>
          <li>
            <strong>The second does not fall: we are the verifier.</strong>{" "}
            The obvious answer to a proof too expensive for your browser is
            that we compute it for you — and that answer is not available to
            us at any price. A proof we generated from your token, on our
            hardware, demonstrates nothing to us that we had not already seen;
            the zero-knowledge property is gone the moment the party being
            convinced is also the party doing the convincing. Any prover we
            ran would be us. So we run no prover, and will not run one even as
            a convenience: proving is done by you, or by a party you choose,
            and we are strictly the side that checks the answer. The circuit
            we pin, the signals we read and the provider keys we accept are
            published at{" "}
            <code>/api/zk/params</code>{" "}
            so that anyone can write a prover we have no say over — and a
            proof from one we have never heard of verifies exactly like a
            proof from one we have.
          </li>
          <li>
            <strong>Which leaves it published rather than available.</strong>{" "}
            The verifier and the protocol exist and are open; no sign-in flow
            uses them, so this is not something you can use yet. We would
            rather say that plainly than let a page about privacy imply a
            protection nobody is currently receiving. What we did instead is
            reduce what arrives at sign-in: we no longer ask Google for your
            email address at all, so it is not something we forget, it is
            something we never receive.
          </li>
          <li>
            <strong>Your tier is visible at redemption.</strong>{" "}
            A token is
            signed by a per-tier key, so spending one reveals which tier it was
            for. It reveals nothing about who.
          </li>
          <li>
            <strong>We cannot revoke anything.</strong>{" "}
            No blocklist, because a
            blocklist is state. A stolen key is good until it expires — fifteen
            minutes for reading, seven days for renewal — and the only remedy is
            rotating our signing key, which signs everybody out at once.
          </li>
        </ul>

        <h2>Why it is built this way</h2>
        <p>
          Because a contract that only holds while everyone behaves is not a
          contract. So the rules are not written as prose that can drift away
          from the code — they are written as tests in{" "}
          <a href="https://github.com/cephroom/cephroom/blob/main/tests/contracts">
            tests/contracts
          </a>{" "}
          — one file per claim on this page. &ldquo;No user table&rdquo; is a
          test that fails if a schema appears; &ldquo;we never read your IP
          address&rdquo; is a test that fails on the line that would read it.
          Every place a rule bends is named in one of them, with the reason,
          because an exception nobody can find is indistinguishable from a
          rule nobody keeps.
        </p>
      </div>

      <p className="mt-12 text-[0.85rem] text-ink-muted">
        <Link href="/how-it-works" className="font-medium text-accent hover:underline">
          How the rest of it works →
        </Link>
      </p>
    </main>
  );
}
