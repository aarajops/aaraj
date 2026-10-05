import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

interface RequestContext {
  requestId: string;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

export const requestContextMiddleware: RequestHandler = (
  _request,
  response,
  next,
) => {
  const context = { requestId: randomUUID() };
  response.setHeader("X-Request-Id", context.requestId);
  requestContext.run(context, next);
};

export function getCurrentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
