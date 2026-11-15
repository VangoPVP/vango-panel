import { TRPCError } from "@trpc/server";
import prisma, { type Prisma } from "@vango-panel/db";
import {
  configurationFileSchema,
  EGG_FEATURES,
  eggToTemplate,
  nextFreeName,
  parseConfigFiles,
  parseDockerImages,
  parseTemplateVariables,
  templateVariableSchema,
} from "@vango-panel/wings";
import { z } from "zod";

import { adminProcedure, router } from "../../index";
import { logActivity, uuidRe } from "../../lib/wings";

const idInput = z.object({ id: z.string().regex(uuidRe) });

export const templateFields = z
  .object({
    name: z.string().trim().min(1).max(64),
    description: z.string().max(1000).default(""),
    image: z.string().trim().min(1),
    dockerImages: z.record(z.string().trim().min(1).max(64), z.string().trim().min(1)).default({}),
    startup: z.string().min(1),
    stopType: z.enum(["command", "signal", "stop"]).default("command"),
    stopValue: z.string().default("stop"),
    startupDone: z.array(z.string().min(1)).default([]),
    stripAnsi: z.boolean().default(true),
    configFiles: z.array(configurationFileSchema).default([]),
    fileDenylist: z.array(z.string().min(1)).default([]),
    installImage: z.string().trim().min(1).default("busybox:latest"),
    installEntrypoint: z.string().trim().min(1).default("sh"),
    installScript: z.string().default(""),
    variables: z
      .array(templateVariableSchema)
      .default([])
      .refine((vs) => new Set(vs.map((v) => v.key)).size === vs.length, "variable keys must be unique"),
    features: z.array(z.enum(EGG_FEATURES)).default([]),
  })
  .refine((t) => !Object.keys(t.dockerImages).length || Object.values(t.dockerImages).includes(t.image), {
    message: "The default image must be one of the template's images",
    path: ["image"],
  });

type TemplateInput = z.infer<typeof templateFields>;

function toData(input: TemplateInput) {
  const { configFiles, variables, dockerImages, features, ...rest } = input;
  return {
    ...rest,
    features: [...new Set(features)],
    configFiles: configFiles as Prisma.InputJsonValue,
    variables: variables as Prisma.InputJsonValue,
    dockerImages: dockerImages as Prisma.InputJsonValue,
  };
}

async function uniqueName<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (typeof e === "object" && e && "code" in e && e.code === "P2002") {
      throw new TRPCError({ code: "CONFLICT", message: "A template with that name already exists" });
    }
    throw e;
  }
}

export const templatesRouter = router({
  list: adminProcedure.query(async () => {
    const ts = await prisma.template.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { servers: true } } },
    });
    return ts.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      image: t.image,
      dockerImages: parseDockerImages(t.dockerImages, t.image),
      servers: t._count.servers,
      variables: parseTemplateVariables(t.variables),
    }));
  }),

  get: adminProcedure.input(idInput).query(async ({ input }) => {
    const t = await prisma.template.findUnique({ where: { id: input.id } });
    if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
    return {
      ...t,
      dockerImages: parseDockerImages(t.dockerImages, t.image),
      configFiles: parseConfigFiles(t.configFiles),
      variables: parseTemplateVariables(t.variables),
    };
  }),

  create: adminProcedure.input(templateFields).mutation(async ({ input }) => {
    const t = await uniqueName(() => prisma.template.create({ data: toData(input) }));
    return { id: t.id };
  }),

  update: adminProcedure
    .input(z.object({ id: z.string().regex(uuidRe), template: templateFields }))
    .mutation(async ({ input }) => {
      await uniqueName(() => prisma.template.update({ where: { id: input.id }, data: toData(input.template) }));
      return { ok: true };
    }),

  addImage: adminProcedure
    .input(
      z.object({
        id: z.string().regex(uuidRe),
        label: z.string().trim().min(1).max(64),
        image: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .regex(/^[a-z0-9][\w.\-/:@]*$/i, "not a docker image reference"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const t = await prisma.template.findUnique({ where: { id: input.id } });
      if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
      const images = parseDockerImages(t.dockerImages, t.image);
      if (Object.values(images).includes(input.image)) return { ok: true, added: false };
      if (input.label in images) {
        throw new TRPCError({ code: "CONFLICT", message: `The template already has an image labelled "${input.label}"` });
      }
      await prisma.template.update({
        where: { id: t.id },
        data: { dockerImages: { ...images, [input.label]: input.image } },
      });
      await logActivity({
        userId: ctx.session.user.id,
        event: "admin:template.image_added",
        metadata: { template: t.id, label: input.label, image: input.image },
        ip: ctx.ip,
      });
      return { ok: true, added: true };
    }),

  delete: adminProcedure.input(idInput).mutation(async ({ input }) => {
    const count = await prisma.server.count({ where: { templateId: input.id } });
    if (count) throw new TRPCError({ code: "CONFLICT", message: `Template is used by ${count} server(s)` });
    await prisma.template.delete({ where: { id: input.id } });
    return { ok: true };
  }),

  importEgg: adminProcedure
    .input(z.object({ egg: z.unknown(), onConflict: z.enum(["update", "copy"]).default("copy") }))
    .mutation(async ({ ctx, input }) => {
      const result = eggToTemplate(input.egg);
      if (!result.ok) throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
      const parsed = templateFields.safeParse(result.template);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new TRPCError({ code: "BAD_REQUEST", message: `Egg can't be imported: ${issue?.path.join(".")}: ${issue?.message}` });
      }
      const data = parsed.data;

      const out = await prisma.$transaction(async (tx) => {
        const existing = await tx.template.findUnique({ where: { name: data.name } });
        if (existing && input.onConflict === "update") {
          await tx.template.update({ where: { id: existing.id }, data: toData(data) });
          return { id: existing.id, name: data.name, action: "updated" as const };
        }
        let name = data.name;
        if (existing) {
          const taken = await tx.template.findMany({
            where: { name: { startsWith: data.name.replace(/ \(\d+\)$/, "") } },
            select: { name: true },
          });
          name = nextFreeName(data.name, taken.map((t) => t.name));
        }
        const t = await tx.template.create({ data: toData({ ...data, name }) });
        return { id: t.id, name, action: "created" as const };
      });

      await logActivity({
        userId: ctx.session.user.id,
        event: `admin:template.egg_${out.action}`,
        metadata: { template: out.id, name: out.name, author: result.author },
        ip: ctx.ip,
      });
      return { ...out, warnings: result.warnings };
    }),
});
