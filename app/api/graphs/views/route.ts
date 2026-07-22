import { and, asc, desc, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { graphs, graphViews } from "@/db/schema";

type Point = { x: number; y: number; z?: number };
type Viewport = { x: number; y: number; zoom: number };
type ViewState = {
  positions: Record<string, Point>;
  focusRootId: string | null;
  collapsedNodeIds: string[];
  pinnedNodeIds: string[];
  viewport: Viewport;
};

type ViewPayload = {
  id?: unknown;
  graphId?: unknown;
  name?: unknown;
  state?: unknown;
};

class ViewPayloadError extends Error {}

const DEFAULT_VIEWPORT: Viewport = { x: 360, y: 300, zoom: 1 };

async function ownerEmail() {
  return (await getChatGPTUser())?.email ?? null;
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ViewPayloadError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finiteNumberAt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ViewPayloadError(`${path} must be a finite number`);
  }
  return value;
}

function idAt(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ViewPayloadError(`${path} is required`);
  }
  return value.trim();
}

function nameAt(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ViewPayloadError("name is required");
  }
  return value.trim().slice(0, 120);
}

function stringIdsAt(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new ViewPayloadError(`${path} must be an array`);
  const ids = value.map((item, index) => idAt(item, `${path}[${index}]`));
  return [...new Set(ids)];
}

function stateAt(value: unknown, fallback?: ViewState): ViewState {
  const input = recordAt(value, "state");
  const rawPositions = input.positions === undefined
    ? fallback?.positions ?? {}
    : recordAt(input.positions, "state.positions");
  const positions: Record<string, Point> = {};
  for (const [nodeId, rawPoint] of Object.entries(rawPositions)) {
    if (nodeId.trim() === "") throw new ViewPayloadError("state.positions contains an empty node id");
    const point = recordAt(rawPoint, `state.positions.${nodeId}`);
    positions[nodeId] = {
      x: finiteNumberAt(point.x, `state.positions.${nodeId}.x`),
      y: finiteNumberAt(point.y, `state.positions.${nodeId}.y`),
      ...(point.z === undefined ? {} : { z: finiteNumberAt(point.z, `state.positions.${nodeId}.z`) }),
    };
  }

  const rawFocusRootId = input.focusRootId === undefined ? fallback?.focusRootId ?? null : input.focusRootId;
  if (rawFocusRootId !== null && (typeof rawFocusRootId !== "string" || rawFocusRootId.trim() === "")) {
    throw new ViewPayloadError("state.focusRootId must be a node id or null");
  }

  const rawViewport = input.viewport === undefined
    ? fallback?.viewport ?? DEFAULT_VIEWPORT
    : recordAt(input.viewport, "state.viewport");
  const viewport = {
    x: finiteNumberAt(rawViewport.x, "state.viewport.x"),
    y: finiteNumberAt(rawViewport.y, "state.viewport.y"),
    zoom: finiteNumberAt(rawViewport.zoom, "state.viewport.zoom"),
  };
  if (viewport.zoom <= 0) throw new ViewPayloadError("state.viewport.zoom must be greater than zero");

  return {
    positions,
    focusRootId: rawFocusRootId === null ? null : rawFocusRootId.trim(),
    collapsedNodeIds: input.collapsedNodeIds === undefined
      ? fallback?.collapsedNodeIds ?? []
      : stringIdsAt(input.collapsedNodeIds, "state.collapsedNodeIds"),
    pinnedNodeIds: input.pinnedNodeIds === undefined
      ? fallback?.pinnedNodeIds ?? []
      : stringIdsAt(input.pinnedNodeIds, "state.pinnedNodeIds"),
    viewport,
  };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

type StoredView = typeof graphViews.$inferSelect;

function storedState(row: StoredView): ViewState {
  return {
    positions: parseJson(row.positionsJson, {}),
    focusRootId: row.focusRootId,
    collapsedNodeIds: parseJson(row.collapsedNodeIdsJson, []),
    pinnedNodeIds: parseJson(row.pinnedNodeIdsJson, []),
    viewport: parseJson(row.viewportJson, DEFAULT_VIEWPORT),
  };
}

function clientView(row: StoredView) {
  return {
    id: row.id,
    graphId: row.graphId,
    name: row.name,
    isPrimary: row.isPrimary,
    ...storedState(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (error instanceof ViewPayloadError) return Response.json({ error: message }, { status: 400 });
  if (/unique constraint/i.test(message)) {
    return Response.json({ error: "A view with this name already exists" }, { status: 409 });
  }
  return Response.json({ error: message }, { status: 500 });
}

async function ownedGraphExists(graphId: string, owner: string) {
  const [graph] = await getDb()
    .select({ id: graphs.id })
    .from(graphs)
    .where(and(eq(graphs.id, graphId), eq(graphs.ownerEmail, owner)))
    .limit(1);
  return Boolean(graph);
}

export async function GET(request: Request) {
  const owner = await ownerEmail();
  if (!owner) return Response.json({ error: "Authentication required" }, { status: 401 });

  try {
    const graphId = idAt(new URL(request.url).searchParams.get("graphId"), "graphId");
    if (!(await ownedGraphExists(graphId, owner))) {
      return Response.json({ error: "Graph not found" }, { status: 404 });
    }
    const rows = await getDb()
      .select()
      .from(graphViews)
      .where(eq(graphViews.graphId, graphId))
      .orderBy(desc(graphViews.isPrimary), asc(graphViews.createdAt));
    return Response.json({ views: rows.map(clientView) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const owner = await ownerEmail();
  if (!owner) return Response.json({ error: "Authentication required" }, { status: 401 });

  try {
    const payload = (await request.json()) as ViewPayload;
    const graphId = idAt(payload.graphId, "graphId");
    const name = nameAt(payload.name);
    const state = stateAt(payload.state);
    if (!(await ownedGraphExists(graphId, owner))) {
      return Response.json({ error: "Graph not found" }, { status: 404 });
    }
    const now = new Date().toISOString();
    const [created] = await getDb()
      .insert(graphViews)
      .values({
        id: crypto.randomUUID(),
        graphId,
        name,
        isPrimary: false,
        positionsJson: JSON.stringify(state.positions),
        focusRootId: state.focusRootId,
        collapsedNodeIdsJson: JSON.stringify(state.collapsedNodeIds),
        pinnedNodeIdsJson: JSON.stringify(state.pinnedNodeIds),
        viewportJson: JSON.stringify(state.viewport),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return Response.json({ view: clientView(created) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  const owner = await ownerEmail();
  if (!owner) return Response.json({ error: "Authentication required" }, { status: 401 });

  try {
    const payload = (await request.json()) as ViewPayload;
    const id = idAt(payload.id, "id");
    const graphId = idAt(payload.graphId, "graphId");
    if (!(await ownedGraphExists(graphId, owner))) {
      return Response.json({ error: "Graph not found" }, { status: 404 });
    }
    const [existing] = await getDb()
      .select()
      .from(graphViews)
      .where(and(eq(graphViews.id, id), eq(graphViews.graphId, graphId)))
      .limit(1);
    if (!existing) return Response.json({ error: "View not found" }, { status: 404 });

    const name = payload.name === undefined ? existing.name : nameAt(payload.name);
    if (existing.isPrimary && name !== "Principal") {
      return Response.json({ error: "The primary view cannot be renamed" }, { status: 409 });
    }
    const state = payload.state === undefined ? storedState(existing) : stateAt(payload.state, storedState(existing));
    const [updated] = await getDb()
      .update(graphViews)
      .set({
        name,
        positionsJson: JSON.stringify(state.positions),
        focusRootId: state.focusRootId,
        collapsedNodeIdsJson: JSON.stringify(state.collapsedNodeIds),
        pinnedNodeIdsJson: JSON.stringify(state.pinnedNodeIds),
        viewportJson: JSON.stringify(state.viewport),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(graphViews.id, id), eq(graphViews.graphId, graphId)))
      .returning();
    return Response.json({ view: clientView(updated) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const owner = await ownerEmail();
  if (!owner) return Response.json({ error: "Authentication required" }, { status: 401 });

  try {
    const params = new URL(request.url).searchParams;
    const id = idAt(params.get("id"), "id");
    const graphId = idAt(params.get("graphId"), "graphId");
    if (!(await ownedGraphExists(graphId, owner))) {
      return Response.json({ error: "Graph not found" }, { status: 404 });
    }
    const [existing] = await getDb()
      .select({ isPrimary: graphViews.isPrimary })
      .from(graphViews)
      .where(and(eq(graphViews.id, id), eq(graphViews.graphId, graphId)))
      .limit(1);
    if (!existing) return Response.json({ error: "View not found" }, { status: 404 });
    if (existing.isPrimary) {
      return Response.json({ error: "The primary view cannot be deleted" }, { status: 409 });
    }
    await getDb().delete(graphViews).where(and(eq(graphViews.id, id), eq(graphViews.graphId, graphId)));
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
