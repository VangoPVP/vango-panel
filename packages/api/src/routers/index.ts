import { publicProcedure, router } from "../index";
import { accountRouter } from "./account";
import { adminRouter } from "./admin";
import { serversRouter } from "./servers";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  servers: serversRouter,
  account: accountRouter,
  admin: adminRouter,
});
export type AppRouter = typeof appRouter;
