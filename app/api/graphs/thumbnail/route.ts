import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { graphs } from "@/db/schema";
import { normalizeGraph } from "@/lib/graph";
import { graphThumbnailSvg } from "@/lib/graph-thumbnail";
import { graphThumbnailKey, personalR2Get, personalR2Put } from "@/lib/personal-r2";

export async function GET(request: Request) {
  const owner = (await getChatGPTUser())?.email;
  if (!owner) return new Response("Authentication required", { status: 401 });
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const version = params.get("v");
  if (!id || !version) return new Response("Not found", { status: 404 });

  const [row] = await getDb()
    .select({ graphHash: graphs.graphHash, graphJson: graphs.graphJson })
    .from(graphs)
    .where(and(eq(graphs.id, id), eq(graphs.ownerEmail, owner)))
    .limit(1);
  if (!row || row.graphHash !== version) return new Response("Not found", { status: 404 });

  const etag = `"${row.graphHash}"`;
  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { "Cache-Control": "private, max-age=31536000, immutable", ETag: etag },
    });
  }

  const key = await graphThumbnailKey(owner, id, row.graphHash);
  let object = await personalR2Get(key);
  if (!object) {
    await personalR2Put(key, graphThumbnailSvg(normalizeGraph(JSON.parse(row.graphJson))), {
      contentType: "image/svg+xml; charset=utf-8",
      metadata: { graphId: id, graphHash: row.graphHash },
    });
    object = await personalR2Get(key);
  }
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: etag,
    },
  });
}
