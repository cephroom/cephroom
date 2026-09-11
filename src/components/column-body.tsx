import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { ClaimChip, type ClaimView } from "@/components/claim-chip";
import { remarkClaims } from "@/lib/markdown/remark-claims";

/**
 * Renders a column body. Claim references resolve against `claims`, keyed by
 * the author's claim key; anything unresolved renders visibly broken rather
 * than silently disappearing.
 */
export function ColumnBody({
  prose,
  claims,
  canInspect,
}: {
  prose: string;
  claims: Map<string, ClaimView>;
  canInspect: boolean;
}) {
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkClaims]}
        components={componentsWithClaims(claims, canInspect)}
      >
        {prose}
      </ReactMarkdown>
    </div>
  );
}

/**
 * `claim` is not an HTML element - remarkClaims invents it - so the component
 * map needs a cast to sit in react-markdown's typed Components record.
 */
function componentsWithClaims(
  claims: Map<string, ClaimView>,
  canInspect: boolean,
): Components {
  const map = {
    claim: ({ node }: { node?: { properties?: Record<string, unknown> } }) => {
      // hProperties keys reach hast verbatim, so this is the lowercase
      // name set by remarkClaims - not a camelCased data attribute.
      const key = String(node?.properties?.claimkey ?? "");
      return <ClaimChip claim={claims.get(key)} canInspect={canInspect} />;
    },
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="scroll-x">
        <table>{children}</table>
      </div>
    ),
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const external = Boolean(href?.startsWith("http"));
      return (
        <a
          href={href}
          target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer" : undefined}
        >
          {children}
        </a>
      );
    },
  };

  return map as unknown as Components;
}
