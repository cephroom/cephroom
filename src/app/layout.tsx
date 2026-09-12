import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Newsreader } from "next/font/google";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Cephroom — science writing with a build step",
    template: "%s · Cephroom",
  },
  description:
    "A subscription publication for pharmacology and neuroscience, where every number in a column is a live query against a versioned dataset and re-checked on every release.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${newsreader.variable} ${plexMono.variable} h-full`}
    >
      <head>
        {/*
          Dark Reader, and extensions like it, re-derive a page's colours from
          its light theme. Two reasons not to let it here.

          This site already has a real dark theme — a full token set, every
          text-on-background pair measured against WCAG AA in both modes — so
          a second inversion on top of it produces something nobody designed
          and nobody checked.

          More importantly, colour on this page carries meaning. Verified,
          drifted and broken are four deliberately separated hues, held off the
          brand's orange precisely so a reader never has to decide whether an
          orange thing is a warning or a button. An extension remapping that
          scale corrupts the page's primary signal.

          Observed, not theorised: with Dark Reader active this page's SVG
          strokes arrive carrying injected `--darkreader-inline-stroke`
          overrides, which is also the entire content of the hydration warning
          in the dev overlay.

          The lock is a request, not a guarantee, so it is the second line of
          defence rather than the first: every verdict is also carried as a
          word, never by colour alone, and the page stays readable if an
          extension ignores this.
        */}
        <meta name="darkreader-lock" />
      </head>
      <body className="flex min-h-full flex-col bg-paper text-ink">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
