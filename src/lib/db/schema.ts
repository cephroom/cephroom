import { relations } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { AdapterAccountType } from "next-auth/adapters";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

/* ------------------------------------------------------------------ *
 * Auth.js tables
 * Column names follow the shapes @auth/drizzle-adapter expects.
 * ------------------------------------------------------------------ */

export const users = sqliteTable("user", {
  id: id(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  image: text("image"),

  // Bindery-specific profile fields.
  handle: text("handle").unique(),
  bio: text("bio"),
  passwordHash: text("password_hash"),
  role: text("role", { enum: ["reader", "author", "editor"] })
    .notNull()
    .default("reader"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  createdAt: createdAt(),
});

export const accounts = sqliteTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = sqliteTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const verificationTokens = sqliteTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/* ------------------------------------------------------------------ *
 * Billing
 * ------------------------------------------------------------------ */

/**
 * Mirrors the Stripe subscription object. Stripe stays the source of truth;
 * this table is a local projection kept current by the webhook handler so
 * that paywall checks never need a network round-trip.
 */
export const subscriptions = sqliteTable(
  "subscription",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripePriceId: text("stripe_price_id").notNull(),
    plan: text("plan", { enum: ["member", "lab"] }).notNull(),
    interval: text("interval", { enum: ["month", "year"] })
      .notNull()
      .default("month"),
    // Stripe status vocabulary, stored verbatim.
    status: text("status", {
      enum: [
        "incomplete",
        "incomplete_expired",
        "trialing",
        "active",
        "past_due",
        "canceled",
        "unpaid",
        "paused",
      ],
    }).notNull(),
    currentPeriodStart: integer("current_period_start", {
      mode: "timestamp_ms",
    }),
    currentPeriodEnd: integer("current_period_end", { mode: "timestamp_ms" }),
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" })
      .notNull()
      .default(false),
    canceledAt: integer("canceled_at", { mode: "timestamp_ms" }),
    trialEnd: integer("trial_end", { mode: "timestamp_ms" }),
    // Set when an invoice fails, cleared on recovery. Drives the dunning banner.
    paymentFailedAt: integer("payment_failed_at", { mode: "timestamp_ms" }),
    latestInvoiceId: text("latest_invoice_id"),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("subscription_user_idx").on(t.userId)],
);

/**
 * Every Stripe event already applied. The webhook handler inserts here
 * first; a duplicate delivery collides on the primary key and is
 * acknowledged without re-running the side effects.
 */
export const stripeEvents = sqliteTable("stripe_event", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: integer("received_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  processedAt: integer("processed_at", { mode: "timestamp_ms" }),
  error: text("error"),
  payload: text("payload", { mode: "json" }).$type<unknown>(),
});

/* ------------------------------------------------------------------ *
 * Datasets - the evidence layer that claims are checked against
 * ------------------------------------------------------------------ */

export const datasets = sqliteTable("dataset", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  /** Upstream source, e.g. "ChEMBL". */
  source: text("source").notNull(),
  /** Upstream release identifier, e.g. "ChEMBL_37". Part of claim provenance. */
  release: text("release").notNull(),
  /** Monotonic version of this snapshot, bumped on every re-import. */
  version: integer("version").notNull().default(1),
  generatedAt: integer("generated_at", { mode: "timestamp_ms" }),
  /** How the snapshot was produced. Rendered on the dataset page. */
  provenance: text("provenance", { mode: "json" }).$type<{
    pipeline?: string;
    commit?: string;
    notes?: string[];
    coverage?: Record<string, number>;
  }>(),
  createdAt: createdAt(),
});

/**
 * One measured cell of a dataset. Deliberately narrow and generic:
 * (subject, object, metric) maps to a value. For the receptorome import,
 * subject is the target gene symbol and object is the compound name.
 */
export const facts = sqliteTable(
  "fact",
  {
    id: id(),
    datasetId: text("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    object: text("object").notNull(),
    metric: text("metric").notNull(),
    value: real("value"),
    unit: text("unit"),
    /** Number of point estimates behind the value. */
    nPoints: integer("n_points"),
    /** Distinct source documents. Five papers are not five rows in one paper. */
    nDocs: integer("n_docs"),
    /** "human" or "all" - the assay organism scope this cell was computed over. */
    scope: text("scope").notNull().default("all"),
  },
  (t) => [
    uniqueIndex("fact_cell_idx").on(
      t.datasetId,
      t.subject,
      t.object,
      t.metric,
      t.scope,
    ),
    index("fact_lookup_idx").on(t.datasetId, t.metric),
  ],
);

/* ------------------------------------------------------------------ *
 * Columns (articles), revisions, forks, proposals
 * ------------------------------------------------------------------ */

export const columns = sqliteTable(
  "column",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    excerpt: text("excerpt"),
    body: text("body").notNull().default(""),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["draft", "published", "archived"] })
      .notNull()
      .default("draft"),
    /** Who can read the full text. Everything is at least previewable. */
    access: text("access", { enum: ["public", "member", "lab"] })
      .notNull()
      .default("public"),
    /** Lineage: the column this one was forked from, if any. */
    forkedFromId: text("forked_from_id"),
    /** Literal GitHub linkage for the code and notebooks behind the column. */
    repoUrl: text("repo_url"),
    repoCommit: text("repo_commit"),
    readingMinutes: integer("reading_minutes"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("column_author_idx").on(t.authorId),
    index("column_feed_idx").on(t.status, t.publishedAt),
  ],
);

/** Each publish is a commit: an immutable snapshot with a message. */
export const revisions = sqliteTable(
  "revision",
  {
    id: id(),
    columnId: text("column_id")
      .notNull()
      .references(() => columns.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    message: text("message").notNull().default("Update"),
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("revision_number_idx").on(t.columnId, t.number)],
);

/** A reader-submitted edit against a published column. The pull request. */
export const proposals = sqliteTable(
  "proposal",
  {
    id: id(),
    columnId: text("column_id")
      .notNull()
      .references(() => columns.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    rationale: text("rationale").notNull().default(""),
    baseRevisionId: text("base_revision_id").references(() => revisions.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    status: text("status", { enum: ["open", "merged", "closed"] })
      .notNull()
      .default("open"),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    resolvedById: text("resolved_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [index("proposal_column_idx").on(t.columnId, t.status)],
);

/* ------------------------------------------------------------------ *
 * Claims - the core thesis. A number in prose is a query, not a literal.
 * ------------------------------------------------------------------ */

export const claims = sqliteTable(
  "claim",
  {
    id: id(),
    columnId: text("column_id")
      .notNull()
      .references(() => columns.id, { onDelete: "cascade" }),
    /** Author-chosen key referenced from the prose. */
    key: text("key").notNull(),
    datasetSlug: text("dataset_slug").notNull(),
    /** The query, as authored. See src/lib/claims/query.ts. */
    query: text("query", { mode: "json" }).$type<{
      metric: string;
      subject: string;
      object: string;
      scope?: string;
      select?: string;
    }>(),
    /** Raw source text of the claim block, kept for round-tripping. */
    source: text("source").notNull().default(""),
    /** What the author asserted at the time of writing. */
    expectedValue: real("expected_value"),
    expectedUnit: text("expected_unit"),
    /** Allowed drift before the claim is flagged, in percent. */
    tolerancePct: real("tolerance_pct").notNull().default(10),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("claim_key_idx").on(t.columnId, t.key)],
);

/** One execution of every claim in a column. The CI run. */
export const checkRuns = sqliteTable(
  "check_run",
  {
    id: id(),
    columnId: text("column_id")
      .notNull()
      .references(() => columns.id, { onDelete: "cascade" }),
    revisionId: text("revision_id").references(() => revisions.id, {
      onDelete: "set null",
    }),
    trigger: text("trigger", {
      enum: ["publish", "manual", "dataset_release", "schedule"],
    })
      .notNull()
      .default("manual"),
    /** Worst verdict across the claims in the run. */
    conclusion: text("conclusion", {
      enum: ["passing", "drifted", "broken", "empty"],
    })
      .notNull()
      .default("empty"),
    nVerified: integer("n_verified").notNull().default(0),
    nDrifted: integer("n_drifted").notNull().default(0),
    nBroken: integer("n_broken").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("check_run_column_idx").on(t.columnId, t.createdAt)],
);

export const claimResults = sqliteTable(
  "claim_result",
  {
    id: id(),
    checkRunId: text("check_run_id")
      .notNull()
      .references(() => checkRuns.id, { onDelete: "cascade" }),
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    verdict: text("verdict", {
      enum: ["verified", "drifted", "broken"],
    }).notNull(),
    observedValue: real("observed_value"),
    observedUnit: text("observed_unit"),
    /** Signed percentage difference from the authored value. */
    deltaPct: real("delta_pct"),
    datasetRelease: text("dataset_release"),
    datasetVersion: integer("dataset_version"),
    note: text("note"),
    /** Supporting cell metadata at run time, for the claim inspector. */
    evidence: text("evidence", { mode: "json" }).$type<{
      nPoints?: number | null;
      nDocs?: number | null;
      scope?: string;
    } | null>(),
    createdAt: createdAt(),
  },
  (t) => [index("claim_result_run_idx").on(t.checkRunId)],
);

/* ------------------------------------------------------------------ *
 * Engagement
 * ------------------------------------------------------------------ */

export const bookmarks = sqliteTable(
  "bookmark",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    columnId: text("column_id")
      .notNull()
      .references(() => columns.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.columnId] })],
);

export type User = typeof users.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Dataset = typeof datasets.$inferSelect;
export type Fact = typeof facts.$inferSelect;
export type Column = typeof columns.$inferSelect;
export type Revision = typeof revisions.$inferSelect;
export type Proposal = typeof proposals.$inferSelect;
export type Claim = typeof claims.$inferSelect;
export type CheckRun = typeof checkRuns.$inferSelect;
export type ClaimResult = typeof claimResults.$inferSelect;

/* ------------------------------------------------------------------ *
 * Relations - required for the `with` option in drizzle queries.
 * ------------------------------------------------------------------ */

export const usersRelations = relations(users, ({ many }) => ({
  columns: many(columns),
  subscriptions: many(subscriptions),
  proposals: many(proposals),
}));

export const columnsRelations = relations(columns, ({ one, many }) => ({
  author: one(users, { fields: [columns.authorId], references: [users.id] }),
  revisions: many(revisions),
  proposals: many(proposals),
  claims: many(claims),
  checkRuns: many(checkRuns),
}));

export const revisionsRelations = relations(revisions, ({ one }) => ({
  column: one(columns, {
    fields: [revisions.columnId],
    references: [columns.id],
  }),
  author: one(users, { fields: [revisions.authorId], references: [users.id] }),
}));

export const proposalsRelations = relations(proposals, ({ one }) => ({
  column: one(columns, {
    fields: [proposals.columnId],
    references: [columns.id],
  }),
  author: one(users, { fields: [proposals.authorId], references: [users.id] }),
}));

export const claimsRelations = relations(claims, ({ one, many }) => ({
  column: one(columns, { fields: [claims.columnId], references: [columns.id] }),
  results: many(claimResults),
}));

export const checkRunsRelations = relations(checkRuns, ({ one, many }) => ({
  column: one(columns, {
    fields: [checkRuns.columnId],
    references: [columns.id],
  }),
  results: many(claimResults),
}));

export const claimResultsRelations = relations(claimResults, ({ one }) => ({
  checkRun: one(checkRuns, {
    fields: [claimResults.checkRunId],
    references: [checkRuns.id],
  }),
  claim: one(claims, {
    fields: [claimResults.claimId],
    references: [claims.id],
  }),
}));

export const datasetsRelations = relations(datasets, ({ many }) => ({
  facts: many(facts),
}));

export const factsRelations = relations(facts, ({ one }) => ({
  dataset: one(datasets, {
    fields: [facts.datasetId],
    references: [datasets.id],
  }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  user: one(users, { fields: [subscriptions.userId], references: [users.id] }),
}));
