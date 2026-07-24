import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { graphs } from "@/db/schema";
import {
  graphStoragePrefix,
  personalR2Delete,
  personalR2Get,
  personalR2Put,
} from "@/lib/personal-r2";

const MAX_PDF_BYTES = 25 * 1024 * 1024;

async function ownerEmail() {
  return (await getChatGPTUser())?.email ?? null;
}

async function ownedGraph(graphId: string, owner: string) {
  const [graph] = await getDb()
    .select({ id: graphs.id })
    .from(graphs)
    .where(and(eq(graphs.id, graphId), eq(graphs.ownerEmail, owner)))
    .limit(1);
  return Boolean(graph);
}

function safeFileName(value: string) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const withExtension = normalized.toLowerCase().endsWith(".pdf") ? normalized : `${normalized || "documento"}.pdf`;
  return withExtension || "documento.pdf";
}

function contentDisposition(kind: "inline" | "attachment", fileName: string) {
  return `${kind}; filename="documento.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

async function validatedKey(owner: string, graphId: string, key: string) {
  const prefix = `${await graphStoragePrefix(owner, graphId)}/attachments/`;
  return key.startsWith(prefix) && !key.includes("../") ? key : null;
}

export async function GET(request: Request) {
  const owner = await ownerEmail();
  if (!owner) return Response.json({ error: "Authentication required" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const graphId = params.get("graphId")?.trim() ?? "";
  const key = params.get("key")?.trim() ?? "";
  if (!graphId || !key || !(await ownedGraph(graphId, owner))) {
    return Response.json({ error: "PDF not found" }, { status: 404 });
  }
  const validKey = await validatedKey(owner, graphId, key);
  if (!validKey) return Response.json({ error: "PDF not found" }, { status: 404 });
  const object = await personalR2Get(validKey);
  if (!object) return Response.json({ error: "PDF not found" }, { status: 404 });
  const fileName = safeFileName(params.get("name") ?? validKey.split("/").at(-1) ?? "documento.pdf");
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition("inline", fileName),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  const owner = await ownerEmail();
  if (!owner) return Response.json({ error: "Authentication required" }, { status: 401 });
  try {
    const form = await request.formData();
    const graphId = String(form.get("graphId") ?? "").trim();
    const nodeId = String(form.get("nodeId") ?? "").trim();
    const previousKey = String(form.get("previousKey") ?? "").trim();
    const file = form.get("file");
    if (!graphId || !nodeId || !(file instanceof File)) {
      return Response.json({ error: "Grafo, nó e arquivo PDF são obrigatórios." }, { status: 400 });
    }
    if (!(await ownedGraph(graphId, owner))) {
      return Response.json({ error: "Graph not found" }, { status: 404 });
    }
    if (file.size < 5 || file.size > MAX_PDF_BYTES) {
      return Response.json({ error: "O PDF deve ter até 25 MB." }, { status: 413 });
    }
    if (file.type && file.type !== "application/pdf") {
      return Response.json({ error: "Selecione um arquivo PDF." }, { status: 415 });
    }
    if (await file.slice(0, 5).text() !== "%PDF-") {
      return Response.json({ error: "O arquivo não possui uma assinatura PDF válida." }, { status: 415 });
    }

    const attachmentId = crypto.randomUUID();
    const fileName = safeFileName(file.name);
    const key = `${await graphStoragePrefix(owner, graphId)}/attachments/${attachmentId}/${fileName}`;
    await personalR2Put(key, await file.arrayBuffer(), {
      contentType: "application/pdf",
      contentDisposition: contentDisposition("inline", fileName),
      metadata: { graphId, nodeId, attachmentId },
    });

    const validPreviousKey = previousKey ? await validatedKey(owner, graphId, previousKey) : null;
    if (validPreviousKey && validPreviousKey !== key) await personalR2Delete(validPreviousKey);

    const uploadedAt = new Date().toISOString();
    return Response.json({
      attachment: {
        id: attachmentId,
        key,
        fileName,
        size: file.size,
        uploadedAt,
        url: `/api/attachments/pdf?graphId=${encodeURIComponent(graphId)}&key=${encodeURIComponent(key)}&name=${encodeURIComponent(fileName)}`,
      },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao enviar o PDF.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const owner = await ownerEmail();
  if (!owner) return Response.json({ error: "Authentication required" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const graphId = params.get("graphId")?.trim() ?? "";
  const key = params.get("key")?.trim() ?? "";
  if (!graphId || !key || !(await ownedGraph(graphId, owner))) {
    return Response.json({ error: "PDF not found" }, { status: 404 });
  }
  const validKey = await validatedKey(owner, graphId, key);
  if (!validKey) return Response.json({ error: "PDF not found" }, { status: 404 });
  await personalR2Delete(validKey);
  return new Response(null, { status: 204 });
}
