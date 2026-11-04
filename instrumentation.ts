// Next.js calls this for every error on the server: pages, route handlers, server actions and middleware. The record
// keeps the route pattern (/admin/deals/[id]), never the address someone typed. The import sits inside the runtime
// check so the edge build leaves it out.
import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recordError } = await import("./lib/errors");
    const kind = context.routeType === "render" ? "render" : context.routeType === "action" ? "action" : context.routeType === "middleware" ? "middleware" : "route";
    await recordError(error, context.routePath || "unknown", kind);
  }
};
