import type { Root, Text } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

/**
 * Turns `{{claim:key}}` in the prose into a `<claim data-claim-key="key">`
 * element in the rendered tree, which react-markdown maps to a component.
 *
 * Doing this in remark rather than by enabling raw HTML matters: authors are
 * writing Markdown that other people read, and rehype-raw would hand every
 * author a script tag. This plugin adds exactly one element type and nothing
 * else.
 */
export const remarkClaims: Plugin<[], Root> = () => (tree) => {
  visit(tree, "text", (node: Text, index, parent) => {
    if (!parent || index === undefined) return;
    if (!node.value.includes("{{claim:")) return;

    const pattern = /\{\{claim:([A-Za-z0-9][\w-]*)\}\}/g;
    const replacement: (Text | ClaimNode)[] = [];
    let cursor = 0;

    for (const match of node.value.matchAll(pattern)) {
      const start = match.index!;
      if (start > cursor) {
        replacement.push({
          type: "text",
          value: node.value.slice(cursor, start),
        });
      }
      replacement.push({
        type: "claimReference",
        claimKey: match[1],
        data: {
          hName: "claim",
          hProperties: { claimkey: match[1] },
        },
      });
      cursor = start + match[0].length;
    }

    if (cursor < node.value.length) {
      replacement.push({ type: "text", value: node.value.slice(cursor) });
    }

    parent.children.splice(index, 1, ...(replacement as never[]));
    return index + replacement.length;
  });
};

interface ClaimNode {
  type: "claimReference";
  claimKey: string;
  data: {
    hName: string;
    hProperties: Record<string, string>;
  };
}
