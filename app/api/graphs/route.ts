import { and, desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { graphs } from "@/db/schema";
import { GraphValidationError, normalizeGraph } from "@/lib/graph";
import { graphContentHash, graphThumbnailSvg } from "@/lib/graph-thumbnail";

type GraphPayload = {
  id?: string;
  name?: string;
  graph?: unknown;
};

async function ownerEmail() {
  return (await getChatGPTUser())?.email ?? null;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return Response.json({ error: message }, { status: error instanceof GraphValidationError ? 400 : 500 });
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
      return Response.json({ graph: { ...row, data: JSON.parse(row.graphJson) } });
    }

    const rows = await db
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
    return Response.json({
      graphs: rows.map((row) => ({
        ...row,
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
    const id = crypto.randomUUID();
    const name = payload.name?.trim().slice(0, 120) || graph.name || "Novo grafo";
    const graphJson = JSON.stringify({ ...graph, name });
    const graphHash = await graphContentHash(graphJson);
    const thumbnailKey = `graphs/${id}/${graphHash}.svg`;
    await env.THUMBNAILS.put(thumbnailKey, graphThumbnailSvg(graph), {
      httpMetadata: { contentType: "image/svg+xml; charset=utf-8" },
    });
    const now = new Date().toISOString();
    const [created] = await getDb()
      .insert(graphs)
      .values({
        id,
        ownerEmail: owner,
        name,
        graphJson,
        graphHash,
        thumbnailKey,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: graphs.id, name: graphs.name, updatedAt: graphs.updatedAt });
    return Response.json({ graph: created }, { status: 201 });
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
    const thumbnailKey = existing.graphHash === graphHash
      ? existing.thumbnailKey
      : `graphs/${payload.id}/${graphHash}.svg`;
    if (existing.graphHash !== graphHash) {
      await env.THUMBNAILS.put(thumbnailKey, graphThumbnailSvg(graph), {
        httpMetadata: { contentType: "image/svg+xml; charset=utf-8" },
      });
    }
    const now = new Date().toISOString();
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
    if (existing.thumbnailKey !== thumbnailKey) await env.THUMBNAILS.delete(existing.thumbnailKey);
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
      .select({ thumbnailKey: graphs.thumbnailKey })
      .from(graphs)
      .where(and(eq(graphs.id, id), eq(graphs.ownerEmail, owner)))
      .limit(1);
    await db.delete(graphs).where(and(eq(graphs.id, id), eq(graphs.ownerEmail, owner)));
    if (existing) await env.THUMBNAILS.delete(existing.thumbnailKey);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
