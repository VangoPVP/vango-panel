import { TRPCError } from "@trpc/server";
import { isAdminRole } from "@vango-panel/auth/roles";
import type { Prisma } from "@vango-panel/db";
import {
  EDITOR_MAX_BYTES,
  isValidMode,
  isValidName,
  normalizePath,
  signFileDownloadToken,
  signUploadToken,
} from "@vango-panel/wings";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { callWings, loadAccessibleServer, logActivity, requirePermission, uuidRe, wingsFor } from "../lib/wings";

const id = z.string().regex(uuidRe, "invalid server id");
const path = z.string().max(4096).transform(normalizePath);
const name = z.string().trim().refine(isValidName, "invalid name (no slashes, not . or ..)");

type User = { id: string; role?: string | null };

async function fileServer(user: User, serverId: string, perm: string) {
  const { server, permissions } = await loadAccessibleServer(user, serverId);
  requirePermission(permissions, perm);
  if (server.suspended && !isAdminRole(user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Server is suspended" });
  }
  if (server.status === "installing") {
    throw new TRPCError({ code: "CONFLICT", message: "Server is still installing" });
  }
  return { server, wings: wingsFor(server.node) };
}

async function audit(
  ctx: { session: { user: { id: string } }; ip: string | null },
  serverId: string,
  event: string,
  metadata: Prisma.InputJsonValue,
) {
  await logActivity({ serverId, userId: ctx.session.user.id, event, metadata, ip: ctx.ip });
}

export const serverFilesRouter = router({
  list: protectedProcedure.input(z.object({ id, directory: path })).query(async ({ ctx, input }) => {
    const { server, wings } = await fileServer(ctx.session.user, input.id, "file.read");
    const files = await callWings(() => wings.listDirectory(server.id, input.directory));
    files.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
    return { directory: input.directory, files };
  }),

  read: protectedProcedure.input(z.object({ id, file: path })).query(async ({ ctx, input }) => {
    const { server, wings } = await fileServer(ctx.session.user, input.id, "file.read-content");
    const content = await callWings(() => wings.readTextFile(server.id, input.file, EDITOR_MAX_BYTES));
    return { file: input.file, content };
  }),

  write: protectedProcedure
    .input(
      z.object({
        id,
        file: path,
        content: z.string().refine((c) => Buffer.byteLength(c) <= EDITOR_MAX_BYTES, "file is too large for the editor"),
        create: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.file === "/") throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid file path" });
      const { server, wings } = await fileServer(ctx.session.user, input.id, input.create ? "file.create" : "file.update");
      await callWings(() => wings.writeFile(server.id, input.file, input.content));
      await audit(ctx, server.id, input.create ? "server:file.created" : "server:file.write", { file: input.file });
      return { ok: true };
    }),

  createDirectory: protectedProcedure
    .input(z.object({ id, directory: path, name }))
    .mutation(async ({ ctx, input }) => {
      const { server, wings } = await fileServer(ctx.session.user, input.id, "file.create");
      await callWings(() => wings.createDirectory(server.id, input.directory, input.name));
      await audit(ctx, server.id, "server:file.create-directory", { directory: input.directory, name: input.name });
      return { ok: true };
    }),

  rename: protectedProcedure
    .input(
      z.object({
        id,
        root: path,
        files: z.array(z.object({ from: z.string().min(1).max(4096), to: z.string().min(1).max(4096) })).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { server, wings } = await fileServer(ctx.session.user, input.id, "file.update");
      const renamed = await callWings(() => wings.rename(server.id, input.root, input.files));
      await audit(ctx, server.id, "server:file.rename", { root: input.root, files: input.files });
      return { renamed };
    }),

  copy: protectedProcedure.input(z.object({ id, location: path })).mutation(async ({ ctx, input }) => {
    const { server, wings } = await fileServer(ctx.session.user, input.id, "file.create");
    const stat = await callWings(() => wings.copy(server.id, input.location));
    await audit(ctx, server.id, "server:file.copy", { file: input.location });
    return stat;
  }),

  delete: protectedProcedure
    .input(z.object({ id, root: path, files: z.array(name).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const { server, wings } = await fileServer(ctx.session.user, input.id, "file.delete");
      const deleted = await callWings(() => wings.deleteFiles(server.id, input.root, input.files));
      await audit(ctx, server.id, "server:file.delete", { directory: input.root, files: input.files });
      return { deleted };
    }),

  compress: protectedProcedure
    .input(z.object({ id, root: path, files: z.array(name).min(1).max(500), format: z.enum(["tar.gz", "zip"]) }))
    .mutation(async ({ ctx, input }) => {
      const { server, wings } = await fileServer(ctx.session.user, input.id, "file.archive");
      const stat = await callWings(() => wings.compress(server.id, input.root, input.files, input.format));
      await audit(ctx, server.id, "server:file.compress", { directory: input.root, files: input.files, archive: stat.name });
      return stat;
    }),

  decompress: protectedProcedure
    .input(z.object({ id, root: path, file: name }))
    .mutation(async ({ ctx, input }) => {
      const { server, wings } = await fileServer(ctx.session.user, input.id, "file.archive");
      await callWings(() => wings.decompress(server.id, input.root, input.file));
      await audit(ctx, server.id, "server:file.decompress", { directory: input.root, file: input.file });
      return { ok: true };
    }),

  chmod: protectedProcedure
    .input(
      z.object({
        id,
        root: path,
        files: z.array(z.object({ file: name, mode: z.string().refine(isValidMode, "mode like 644 or 755") })).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { server, wings } = await fileServer(ctx.session.user, input.id, "file.update");
      const updated = await callWings(() => wings.chmod(server.id, input.root, input.files));
      await audit(ctx, server.id, "server:file.chmod", { directory: input.root, files: input.files });
      return { updated };
    }),

  pull: protectedProcedure
    .input(
      z.object({
        id,
        url: z.url({ protocol: /^https?$/ }).max(2048),
        directory: path,
        filename: name.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { server, wings } = await fileServer(ctx.session.user, input.id, "file.create");
      await callWings(() => wings.pull(server.id, input.url, input.directory, input.filename));
      await audit(ctx, server.id, "server:file.pull", { url: input.url, directory: input.directory });
      return { ok: true };
    }),

  downloadUrl: protectedProcedure.input(z.object({ id, file: path })).mutation(async ({ ctx, input }) => {
    const { server, wings } = await fileServer(ctx.session.user, input.id, "file.read-content");
    const token = signFileDownloadToken({ nodeToken: wings.nodeToken, serverId: server.id, filePath: input.file });
    await audit(ctx, server.id, "server:file.download", { file: input.file });
    return { url: wings.downloadUrl(token) };
  }),

  uploadToken: protectedProcedure.input(z.object({ id })).mutation(async ({ ctx, input }) => {
    const { server, wings } = await fileServer(ctx.session.user, input.id, "file.create");
    const { token, expiresAt } = signUploadToken({
      nodeToken: wings.nodeToken,
      serverId: server.id,
      userId: ctx.session.user.id,
    });
    return { url: wings.uploadChunkUrl(), token, expiresAt, chunkSize: 8 * 1024 * 1024 };
  }),
});
