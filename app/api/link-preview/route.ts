import { getChatGPTUser } from "@/app/chatgpt-auth";
import { isLinkPreviewCategory } from "@/lib/graph";
import { getLinkPreview, LinkPreviewError } from "@/lib/link-preview";

type PreviewPayload = { url?: unknown; categoryId?: unknown };

export async function POST(request: Request) {
  if (!(await getChatGPTUser())) {
    return Response.json({ ok: false, message: "Prévia indisponível" }, { status: 401 });
  }

  try {
    const payload = await request.json() as PreviewPayload;
    if (typeof payload.url !== "string" || typeof payload.categoryId !== "string" || !isLinkPreviewCategory(payload.categoryId)) {
      return Response.json({ ok: false, message: "Prévia indisponível" }, { status: 400 });
    }
    const preview = await getLinkPreview(payload.url, payload.categoryId);
    return Response.json({ ok: true, preview }, {
      headers: { "Cache-Control": "private, max-age=900" },
    });
  } catch (error) {
    const status = error instanceof LinkPreviewError ? error.status : 502;
    return Response.json({ ok: false, message: "Prévia indisponível" }, { status });
  }
}
