import { createPrismaClient } from "@vango-panel/db";
import { env } from "@vango-panel/env/server";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";

import { USERNAME_MAX, USERNAME_MIN, usernameError, usernameFromSeed } from "./username";

export function createAuth() {
  const prisma = createPrismaClient();

  return betterAuth({
    database: prismaAdapter(prisma, {
      provider: "postgresql",
    }),

    trustedOrigins: [env.CORS_ORIGIN],
    emailAndPassword: {
      enabled: true,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    plugins: [
      nextCookies(),
      username({
        minUsernameLength: USERNAME_MIN,
        maxUsernameLength: USERNAME_MAX,
        usernameValidator: (u) => usernameError(u) === null,
      }),
    ],
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "user",
          input: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const u = user as typeof user & { username?: string | null };
            if (u.username) return;
            const base = usernameFromSeed(u.name || u.email);
            let candidate = base;
            for (let i = 2; await prisma.user.findUnique({ where: { username: candidate } }); i++) {
              candidate = `${base}${i}`;
            }
            return { data: { ...u, username: candidate, displayUsername: candidate } };
          },
          after: async (user) => {
            if (await prisma.user.count({ where: { role: "superadmin" } })) return;
            try {
              await prisma.user.update({ where: { id: user.id }, data: { role: "superadmin" } });
            } catch (e) {
              if (typeof e === "object" && e && "code" in e && e.code === "P2002") return;
              throw e;
            }
          },
        },
      },
    },
  });
}

export const auth = createAuth();
