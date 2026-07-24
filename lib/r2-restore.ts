import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { graphs, graphViews } from "@/db/schema";
import { normalizeGraph } from "@/lib/graph";
import { graphContentHash } from "@/lib/graph-thumbnail";
import {
  graphJsonKey,
  graphThumbnailKey,
  graphViewsKey,
  personalR2Get,
  userGraphIndexKey,
} from "@/lib/personal-r2";

type ArchivedGraphSummary = {
  id: string;
  name: string;
  graphHash?: string;
  createdAt?: string;
  updatedAt?: string;
};

type ArchivedView = {
  id: string;
  name: string;
  isPrimary?: boolean;
  positions?: unknown;
  focusRootId?: unknown;
  collapsedNodeIds?: unknown;
  pinnedNodeIds?: unknown;
  viewport?: unknown;
  createdAt?: string;
  updatedAt?: string;
};

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function archivedGraphSummary(value: unknown): ArchivedGraphSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const id = nonEmptyString(input.id);
  const name = nonEmptyString(input.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    graphHash: nonEmptyString(input.graphHash) ?? undefined,
    createdAt: nonEmptyString(input.createdAt) ?? undefined,
    updatedAt: nonEmptyString(input.updatedAt) ?? undefined,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const id = nonEmptyString(item);
        return id ? [id] : [];
      })
    : [];
}

function recordOr(value: unknown, fallback: Record<string, unknown>) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : fallback;
}

function archivedView(value: unknown): ArchivedView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const id = nonEmptyString(input.id);
  const name = nonEmptyString(input.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    isPrimary: input.isPrimary === true,
    positions: recordOr(input.positions, {}),
    focusRootId: input.focusRootId,
    collapsedNodeIds: stringArray(input.collapsedNodeIds),
    pinnedNodeIds: stringArray(input.pinnedNodeIds),
    viewport: recordOr(input.viewport, { x: 360, y: 300, zoom: 1 }),
    createdAt: nonEmptyString(input.createdAt) ?? undefined,
    updatedAt: nonEmptyString(input.updatedAt) ?? undefined,
  };
}

/**
 * Recreates an empty local D1 database from the personal R2 archive.
 */
export async function restoreLocalGraphsFromR2WhenEmpty(ownerEmail: string) {
  const db = getDb();
  const existing = await db
    .select({ id: graphs.id })
    .from(graphs)
    .where(eq(graphs.ownerEmail, ownerEmail))
    .limit(1);
  if (existing.length) return;

  const indexObject = await personalR2Get(await userGraphIndexKey(ownerEmail));
  if (!indexObject) return;
  const index = await indexObject.json() as { graphs?: unknown };
  if (!Array.isArray(index.graphs)) return;

  for (const rawSummary of index.graphs) {
    const summary = archivedGraphSummary(rawSummary);
    if (!summary) continue;

    const graphObject = await personalR2Get(await graphJsonKey(ownerEmail, summary.id));
    if (!graphObject) continue;
    const graphBundle = await graphObject.json() as { graph?: unknown };
    if (!graphBundle.graph) continue;

    const graph = normalizeGraph(graphBundle.graph);
    const graphJson = JSON.stringify({ ...graph, name: summary.name });
    const graphHash = summary.graphHash ?? await graphContentHash(graphJson);
    const now = new Date().toISOString();
    const createdAt = summary.createdAt ?? summary.updatedAt ?? now;
    const updatedAt = summary.updatedAt ?? createdAt;

    await db.insert(graphs).values({
      id: summary.id,
      ownerEmail,
      name: summary.name,
      graphJson,
      graphHash,
      thumbnailKey: await graphThumbnailKey(ownerEmail, summary.id, graphHash),
      createdAt,
      updatedAt,
    }).onConflictDoNothing();

    const viewsObject = await personalR2Get(await graphViewsKey(ownerEmail, summary.id));
    if (!viewsObject) continue;
    const viewsBundle = await viewsObject.json() as { views?: unknown };
    if (!Array.isArray(viewsBundle.views)) continue;

    for (const rawView of viewsBundle.views) {
      const view = archivedView(rawView);
      if (!view) continue;
      await db.insert(graphViews).values({
        id: view.id,
        graphId: summary.id,
        name: view.name,
        isPrimary: view.isPrimary ?? false,
        positionsJson: JSON.stringify(view.positions ?? {}),
        focusRootId: nonEmptyString(view.focusRootId),
        collapsedNodeIdsJson: JSON.stringify(view.collapsedNodeIds ?? []),
        pinnedNodeIdsJson: JSON.stringify(view.pinnedNodeIds ?? []),
        viewportJson: JSON.stringify(view.viewport ?? { x: 360, y: 300, zoom: 1 }),
        createdAt: view.createdAt ?? createdAt,
        updatedAt: view.updatedAt ?? updatedAt,
      }).onConflictDoNothing();
    }
  }
}
