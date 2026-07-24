import { and, desc, eq, sql } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { graphs, graphViews } from "@/db/schema";
import { GraphValidationError, normalizeGraph, type GraphData } from "@/lib/graph";
import { graphContentHash, graphThumbnailSvg } from "@/lib/graph-thumbnail";
import {
  graphJsonKey,
  graphThumbnailKey,
  graphViewsKey,
  personalR2Delete,
  personalR2Get,
  personalR2Put,
  personalR2PutJson,
  userGraphIndexKey,
} from "@/lib/personal-r2";

type GraphPayload = {
  id?: string;
  name?: string;
  graph?: unknown;
  upsertByName?: boolean;
};

async function ownerEmail() {
  return (await getChatGPTUser())?.email ?? null;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return Response.json({ error: message }, { status: error instanceof GraphValidationError ? 400 : 500 });
}

async function saveGraphArchive(
  owner: string,
  id: string,
  name: string,
  graph: GraphData,
  graphHash: string,
  updatedAt: string,
) {
  const [jsonKey, thumbnailKey] = await Promise.all([
    graphJsonKey(owner, id),
    graphThumbnailKey(owner, id, graphHash),
  ]);
  await Promise.all([
    personalR2PutJson(jsonKey, {
      format: "lattice-graph",
      schemaVersion: 1,
      id,
      name,
      ownerEmail: owner,
      graphHash,
      updatedAt,
      graph: { ...graph, name },
    }),
    personalR2Put(thumbnailKey, graphThumbnailSvg(graph), {
      contentType: "image/svg+xml; charset=utf-8",
      metadata: { graphId: id, graphHash },
    }),
  ]);
  return thumbnailKey;
}

async function saveGraphIndex(owner: string) {
  const rows = await getDb()
    .select({
      id: graphs.id,
      name: graphs.name,
      graphHash: graphs.graphHash,
      createdAt: graphs.createdAt,
      updatedAt: graphs.updatedAt,
    })
    .from(graphs)
    .where(eq(graphs.ownerEmail, owner))
    .orderBy(desc(graphs.updatedAt));
  await personalR2PutJson(await userGraphIndexKey(owner), {
    format: "lattice-index",
    schemaVersion: 1,
    ownerEmail: owner,
    updatedAt: new Date().toISOString(),
    graphs: rows,
  });
}

function pdfObjectKeys(graph: GraphData) {
  return [...new Set(graph.nodes.flatMap((node) => {
    const key = node.properties.pdfObjectKey;
    return typeof key === "string" && key ? [key] : [];
  }))];
}

export async function GET(request: Request) {
  const owner = await ownerEmail();
  if (!owner) return Response.json({ error: "Authentication required" }, { status: 401 });

  try {
    const id = new URL(request.url).searchParams.get("id");
    const db = getDb();
    if (id) {
      const [row] = await db
        .select({ id: graphs.id, name: graphs.name, graphJson: graphs.graphJson, updatedAt: graphs.updatedAt })
        .from(graphs)
        .where(and(eq(graphs.id, id), eq(graphs.ownerEmail, owner)))
        .limit(1);
      if (!row) return Response.json({ error: "Graph not found" }, { status: 404 });
      const key = await graphJsonKey(owner, row.id);
      const archived = await personalR2Get(key);
      if (archived) {
        const bundle = await archived.json() as { graph?: unknown };
        if (bundle.graph) {
          const graph = normalizeGraph(bundle.graph);
          return Response.json({ graph: { id: row.id, name: row.name, raw: JSON.stringify(graph), updatedAt: row.updatedAt } });
        }
      }
      const graph = normalizeGraph(JSON.parse(row.graphJson));
      const graphHash = await graphContentHash(JSON.stringify(graph));
      await saveGraphArchive(owner, row.id, row.name, graph, graphHash, row.updatedAt);
      return Response.json({ graph: { id: row.id, name: row.name, raw: JSON.stringify(graph), updatedAt: row.updatedAt } });
    }

    const rows = await db
      .select({
        id: graphs.id,
        name: graphs.name,
        graphJson: graphs.graphJson,
        graphHash: graphs.graphHash,
        thumbnailKey: graphs.thumbnailKey,
        createdAt: graphs.createdAt,
        updatedAt: graphs.updatedAt,
      })
      .from(graphs)
      .where(eq(graphs.ownerEmail, owner))
      .orderBy(desc(graphs.updatedAt));
    for (const row of rows) {
      const graph = normalizeGraph(JSON.parse(row.graphJson));
      const thumbnailKey = await saveGraphArchive(owner, row.id, row.name, graph, row.graphHash, row.updatedAt);
      if (row.thumbnailKey !== thumbnailKey) {
        await db.update(graphs).set({ thumbnailKey }).where(and(eq(graphs.id, row.id), eq(graphs.ownerEmail, owner)));
      }
    }
    await saveGraphIndex(owner);
    return Response.json({
      graphs: rows.map((row) => ({
        id: row.id,
        name: row.name,
        graphHash: row.graphHash,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        thumbnailUrl: `/api/graphs/thumbnail?id=${encodeURIComponent(row.id)}&v=${row.graphHash}`,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const owner = await ownerEmail();
  if (!owner) return Response.json({ error: "Authentication required" }, { status: 401 });

  try {
    const payload = (await request.json()) as GraphPayload;
    const graph = normalizeGraph(payload.graph);
    const name = payload.name?.trim().slice(0, 120) || graph.name || "Novo grafo";
    const db = getDb();
    if (payload.upsertByName) {
      const [existing] = await db
        .select({
          id: graphs.id,
          name: graphs.name,
          graphJson: graphs.graphJson,
          graphHash: graphs.graphHash,
          updatedAt: graphs.updatedAt,
        })
        .from(graphs)
        .where(and(
          eq(graphs.ownerEmail, owner),
          sql`lower(${graphs.name}) = lower(${name})`,
        ))
        .orderBy(desc(graphs.updatedAt))
        .limit(1);
      if (existing) {
        await saveGraphArchive(
          owner,
          existing.id,
          existing.name,
          normalizeGraph(JSON.parse(existing.graphJson)),
          existing.graphHash,
          existing.updatedAt,
        );
        return Response.json({ graph: { id: existing.id, name: existing.name, updatedAt: existing.updatedAt }, created: false });
      }
    }
    const id = crypto.randomUUID();
    const graphJson = JSON.stringify({ ...graph, name });
    const graphHash = await graphContentHash(graphJson);
    const now = new Date().toISOString();
    const thumbnailKey = await saveGraphArchive(owner, id, name, graph, graphHash, now);
    const primaryView = {
      id: crypto.randomUUID(),
      graphId: id,
      name: "Principal",
      isPrimary: true,
      positions: Object.fromEntries(graph.nodes.map((node) => [
        node.id,
        { x: node.x, y: node.y, ...(node.z === undefined ? {} : { z: node.z }) },
      ])),
      focusRootId: null,
      collapsedNodeIds: [],
      pinnedNodeIds: [],
      viewport: { x: 360, y: 300, zoom: 1 },
      createdAt: now,
      updatedAt: now,
    };
    await db.batch([
      db.insert(graphs).values({
        id,
        ownerEmail: owner,
        name,
        graphJson,
        graphHash,
        thumbnailKey,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(graphViews).values({
        id: primaryView.id,
        graphId: id,
        name: "Principal",
        isPrimary: true,
        positionsJson: JSON.stringify(primaryView.positions),
        focusRootId: null,
        collapsedNodeIdsJson: "[]",
        pinnedNodeIdsJson: "[]",
        viewportJson: JSON.stringify({ x: 360, y: 300, zoom: 1 }),
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    await Promise.all([
      personalR2PutJson(await graphViewsKey(owner, id), {
        format: "lattice-views",
        schemaVersion: 1,
        graphId: id,
        updatedAt: now,
        views: [primaryView],
      }),
      saveGraphIndex(owner),
    ]);
    const created = { id, name, updatedAt: now };
    return Response.json({ graph: created, created: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  const owner = await ownerEmail();
  if (!owner) return Response.json({ error: "Authentication required" }, { status: 401 });

  try {
    const payload = (await request.json()) as GraphPayload;
    if (!payload.id) return Response.json({ error: "id is required" }, { status: 400 });
    const graph = normalizeGraph(payload.graph);
    const name = payload.name?.trim().slice(0, 120) || graph.name || "Sem título";
    const graphJson = JSON.stringify({ ...graph, name });
    const graphHash = await graphContentHash(graphJson);
    const db = getDb();
    const [existing] = await db
      .select({ graphHash: graphs.graphHash, thumbnailKey: graphs.thumbnailKey })
      .from(graphs)
      .where(and(eq(graphs.id, payload.id), eq(graphs.ownerEmail, owner)))
      .limit(1);
    if (!existing) return Response.json({ error: "Graph not found" }, { status: 404 });
    const now = new Date().toISOString();
    const thumbnailKey = await saveGraphArchive(owner, payload.id, name, graph, graphHash, now);
    const [updated] = await db
      .update(graphs)
      .set({
        name,
        graphJson,
        graphHash,
        thumbnailKey,
        updatedAt: now,
      })
      .where(and(eq(graphs.id, payload.id), eq(graphs.ownerEmail, owner)))
      .returning({ id: graphs.id, name: graphs.name, updatedAt: graphs.updatedAt });
    if (!updated) return Response.json({ error: "Graph not found" }, { status: 404 });
    if (existing.graphHash !== graphHash) {
      await personalR2Delete(await graphThumbnailKey(owner, payload.id, existing.graphHash));
    }
    await saveGraphIndex(owner);
    return Response.json({ graph: updated });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const owner = await ownerEmail();
  if (!owner) return Response.json({ error: "Authentication required" }, { status: 401 });

  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "id is required" }, { status: 400 });
    const db = getDb();
    const [existing] = await db
      .select({
        graphJson: graphs.graphJson,
        graphHash: graphs.graphHash,
      })
      .from(graphs)
      .where(and(eq(graphs.id, id), eq(graphs.ownerEmail, owner)))
      .limit(1);
    if (existing) {
      await db.batch([
        db.delete(graphViews).where(eq(graphViews.graphId, id)),
        db.delete(graphs).where(and(eq(graphs.id, id), eq(graphs.ownerEmail, owner))),
      ]);
    }
    if (existing) {
      const graph = normalizeGraph(JSON.parse(existing.graphJson));
      await Promise.all([
        personalR2Delete(await graphJsonKey(owner, id)),
        personalR2Delete(await graphThumbnailKey(owner, id, existing.graphHash)),
        personalR2Delete(await graphViewsKey(owner, id)),
        ...pdfObjectKeys(graph).map((key) => personalR2Delete(key)),
      ]);
      await saveGraphIndex(owner);
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
