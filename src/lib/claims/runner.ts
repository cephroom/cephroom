import "server-only";

import { db } from "@/lib/db";

import * as engine from "./engine";
import type { ParsedClaim } from "./syntax";

/**
 * The check engine, bound to the application's database handle.
 *
 * All the logic lives in ./engine so the seed and release scripts can run the
 * identical code under tsx, where the server-only db module cannot be
 * imported. This file exists only to supply the handle.
 */

export type { ClaimOutcome, CheckTrigger, ReleaseReport } from "./engine";

export const resolveCell = (
  claim: Parameters<typeof engine.resolveCell>[1],
) => engine.resolveCell(db, claim);

export const evaluateClaim = (claim: ParsedClaim & { claimId?: string }) =>
  engine.evaluateClaim(db, claim);

export const syncClaims = (columnId: string, body: string) =>
  engine.syncClaims(db, columnId, body);

export const runChecks = (
  columnId: string,
  options?: Parameters<typeof engine.runChecks>[2],
) => engine.runChecks(db, columnId, options);

export const latestCheckRun = (columnId: string) =>
  engine.latestCheckRun(db, columnId);

export const recheckColumnsCiting = (datasetSlug: string) =>
  engine.recheckColumnsCiting(db, datasetSlug);
