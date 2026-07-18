import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { graphs } from "@/db/schema";

export async function GET(request: Request) {
  const owner = (await getChatGPTUser())?.email;
  if (!owner) return new Response("Authentication required", { status: 401 });
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const version = params.get("v");
  if (!id || !version) return new Response("Not found", { status: 404 });

  const [row] = await getDb()
    .select({ graphHash: graphs.graphHash, thumbnailKey: graphs.thumbnailKey })
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

  const object = await env.THUMBNAILS.get(row.thumbnailKey);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: etag,
    },
  });
}
