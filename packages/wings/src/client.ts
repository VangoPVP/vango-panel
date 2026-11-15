import type { Node } from "@vango-panel/db";
import { z } from "zod";

import { decryptSecret } from "./crypto";
import {
  type FileStat,
  fileStatSchema,
  type PowerAction,
  type ServerDetails,
  type SystemInfo,
  serverDetailsSchema,
  systemInfoSchema,
} from "./protocol";

export class WingsError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "WingsError";
  }
  get unreachable() {
    return this.status === null;
  }
}

const TIMEOUT_MS = 10_000;

type NodeRef = Pick<Node, "url" | "tokenEncrypted">;

export class WingsClient {
  private readonly base: string;
  private readonly token: string;

  constructor(node: NodeRef) {
    this.base = node.url.replace(/\/+$/, "");
    this.token = decryptSecret(node.tokenEncrypted);
  }

  get nodeToken() {
    return this.token;
  }

  websocketUrl(serverId: string) {
    return `${this.base.replace(/^http/, "ws")}/api/servers/${serverId}/ws`;
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const raw = typeof body === "object" && body !== null && "raw" in body ? String((body as { raw: unknown }).raw) : null;
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": raw === null ? "application/json" : "application/octet-stream" }),
        },
        body: body === undefined ? undefined : raw ?? JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const cause = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
      throw new WingsError(`node is unreachable (${cause})`, null);
    }
    if (!res.ok) {
      let message = `node returned HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { error?: unknown };
        if (typeof j.error === "string") message = j.error;
      } catch {
      }
      throw new WingsError(message, res.status);
    }
    return res;
  }

  private async json<S extends z.ZodType>(schema: S, method: string, path: string, body?: unknown) {
    const res = await this.request(method, path, body);
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) throw new WingsError(`unexpected response from node for ${path}`, res.status);
    return parsed.data as z.infer<S>;
  }

  system(): Promise<SystemInfo> {
    return this.json(systemInfoSchema, "GET", "/api/system");
  }

  server(uuid: string): Promise<ServerDetails> {
    return this.json(serverDetailsSchema, "GET", `/api/servers/${uuid}`);
  }

  async createServer(uuid: string, startOnCompletion: boolean) {
    await this.request("POST", "/api/servers", { uuid, start_on_completion: startOnCompletion });
  }

  async deleteServer(uuid: string) {
    await this.request("DELETE", `/api/servers/${uuid}`);
  }

  async power(uuid: string, action: PowerAction, waitSeconds?: number) {
    await this.request("POST", `/api/servers/${uuid}/power`, {
      action,
      ...(waitSeconds ? { wait_seconds: waitSeconds } : {}),
    });
  }

  async commands(uuid: string, commands: string[]) {
    await this.request("POST", `/api/servers/${uuid}/commands`, { commands });
  }

  async reinstall(uuid: string) {
    await this.request("POST", `/api/servers/${uuid}/reinstall`);
  }

  async sync(uuid: string) {
    await this.request("POST", `/api/servers/${uuid}/sync`);
  }

  private files(uuid: string, op: string, query?: Record<string, string>) {
    const qs = query ? `?${new URLSearchParams(query)}` : "";
    return `/api/servers/${uuid}/files/${op}${qs}`;
  }

  listDirectory(uuid: string, directory: string): Promise<FileStat[]> {
    return this.json(z.array(fileStatSchema), "GET", this.files(uuid, "list-directory", { directory }));
  }

  async readTextFile(uuid: string, file: string, maxBytes: number): Promise<string> {
    const res = await this.request("GET", this.files(uuid, "contents", { file }));
    const declared = Number(res.headers.get("content-length") ?? "NaN");
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel();
      throw new WingsError("file is too large to edit; download it instead", 413);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new WingsError("file is too large to edit; download it instead", 413);
    if (buf.subarray(0, 8192).includes(0)) throw new WingsError("this looks like a binary file; download it instead", 415);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      throw new WingsError("this file isn't UTF-8 text; download it instead", 415);
    }
  }

  createDirectory(uuid: string, path: string, name: string): Promise<FileStat> {
    return this.json(fileStatSchema, "POST", this.files(uuid, "create-directory"), { name, path });
  }

  async rename(uuid: string, root: string, files: { from: string; to: string }[]): Promise<number> {
    const r = await this.json(z.object({ renamed: z.number() }), "PUT", this.files(uuid, "rename"), { root, files });
    return r.renamed;
  }

  copy(uuid: string, location: string): Promise<FileStat> {
    return this.json(fileStatSchema, "POST", this.files(uuid, "copy"), { location });
  }

  async deleteFiles(uuid: string, root: string, files: string[]): Promise<number> {
    const r = await this.json(z.object({ deleted: z.number() }), "POST", this.files(uuid, "delete"), { root, files });
    return r.deleted;
  }

  compress(uuid: string, root: string, files: string[], format: "tar.gz" | "zip"): Promise<FileStat> {
    return this.json(fileStatSchema, "POST", this.files(uuid, "compress"), { root, files, format });
  }

  async decompress(uuid: string, root: string, file: string) {
    await this.request("POST", this.files(uuid, "decompress"), { root, file });
  }

  async chmod(uuid: string, root: string, files: { file: string; mode: string }[]): Promise<number> {
    const r = await this.json(z.object({ updated: z.number() }), "POST", this.files(uuid, "chmod"), { root, files });
    return r.updated;
  }

  async pull(uuid: string, url: string, directory: string, filename?: string) {
    await this.request("POST", this.files(uuid, "pull"), {
      url,
      directory,
      ...(filename ? { filename } : {}),
      use_header: !filename,
    });
  }

  downloadUrl(token: string) {
    return `${this.base}/download/file?token=${encodeURIComponent(token)}`;
  }
  uploadChunkUrl() {
    return `${this.base}/upload/chunk`;
  }

  async writeFile(uuid: string, file: string, contents: string) {
    await this.request("POST", `/api/servers/${uuid}/files/write?file=${encodeURIComponent(file)}`, { raw: contents });
  }

  async denyWebsocketTokens(uuid: string, jtis: string[]) {
    await this.request("POST", `/api/servers/${uuid}/ws/deny`, { jtis });
  }
}
