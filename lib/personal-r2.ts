import { env } from "cloudflare:workers";
import { AwsClient } from "aws4fetch";

type PersonalR2Environment = {
  LATTICE_R2_ACCOUNT_ID?: string;
  LATTICE_R2_ACCESS_KEY_ID?: string;
  LATTICE_R2_SECRET_ACCESS_KEY?: string;
  LATTICE_R2_BUCKET?: string;
};

type PutOptions = {
  contentType: string;
  contentDisposition?: string;
  metadata?: Record<string, string>;
};

function configuration() {
  const runtime = env as unknown as PersonalR2Environment;
  const accountId = runtime.LATTICE_R2_ACCOUNT_ID?.trim();
  const accessKeyId = runtime.LATTICE_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = runtime.LATTICE_R2_SECRET_ACCESS_KEY?.trim();
  const bucket = runtime.LATTICE_R2_BUCKET?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("O bucket pessoal do Lattice não está configurado.");
  }
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

function objectUrl(key: string) {
  const { accountId, bucket } = configuration();
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `https://${accountId}.r2.cloudflarestorage.com/${encodeURIComponent(bucket)}/${encodedKey}`;
}

function client() {
  const { accessKeyId, secretAccessKey } = configuration();
  return new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: "s3",
    region: "auto",
    retries: 2,
  });
}

async function failure(response: Response, operation: string) {
  const detail = (await response.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
  throw new Error(`${operation} falhou no bucket pessoal (${response.status})${detail ? `: ${detail}` : "."}`);
}

export async function ownerStorageId(ownerEmail: string) {
  const input = new TextEncoder().encode(ownerEmail.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

export async function personalR2Put(
  key: string,
  body: string | ArrayBuffer | ArrayBufferView,
  options: PutOptions,
) {
  const headers = new Headers({ "Content-Type": options.contentType });
  if (options.contentDisposition) headers.set("Content-Disposition", options.contentDisposition);
  for (const [name, value] of Object.entries(options.metadata ?? {})) {
    headers.set(`x-amz-meta-${name}`, value);
  }
  const response = await client().fetch(objectUrl(key), { method: "PUT", headers, body });
  if (!response.ok) await failure(response, "A gravação");
}

export async function personalR2Get(key: string) {
  const response = await client().fetch(objectUrl(key), { method: "GET" });
  if (response.status === 404) return null;
  if (!response.ok) await failure(response, "A leitura");
  return response;
}

export async function personalR2Delete(key: string) {
  const response = await client().fetch(objectUrl(key), { method: "DELETE" });
  if (response.status !== 404 && !response.ok) await failure(response, "A exclusão");
}

export async function personalR2PutJson(key: string, value: unknown) {
  await personalR2Put(key, JSON.stringify(value, null, 2), { contentType: "application/json; charset=utf-8" });
}

export async function graphStoragePrefix(ownerEmail: string, graphId: string) {
  return `users/${await ownerStorageId(ownerEmail)}/graphs/${graphId}`;
}

export async function graphJsonKey(ownerEmail: string, graphId: string) {
  return `${await graphStoragePrefix(ownerEmail, graphId)}/graph.json`;
}

export async function graphThumbnailKey(ownerEmail: string, graphId: string, graphHash: string) {
  return `${await graphStoragePrefix(ownerEmail, graphId)}/thumbnails/${graphHash}.svg`;
}

export async function graphViewsKey(ownerEmail: string, graphId: string) {
  return `${await graphStoragePrefix(ownerEmail, graphId)}/views.json`;
}

export async function userGraphIndexKey(ownerEmail: string) {
  return `users/${await ownerStorageId(ownerEmail)}/index.json`;
}
