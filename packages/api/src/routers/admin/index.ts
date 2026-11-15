import { router } from "../../index";
import { nodesRouter } from "./nodes";
import { adminServersRouter } from "./servers";
import { templatesRouter } from "./templates";
import { usersRouter } from "./users";

export const adminRouter = router({
  nodes: nodesRouter,
  templates: templatesRouter,
  servers: adminServersRouter,
  users: usersRouter,
});
