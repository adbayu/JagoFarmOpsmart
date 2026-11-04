import { OpSmartStore } from "./store.js";

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
  runNotificationTick(): Promise<void>;
}

export interface Env {
  APP_ORIGIN: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
  OPSMART_STORE: { getByName(name: string): DurableObjectStub };
}

interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

const worker = {
  async fetch(request: Request, env: Env) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      const store = env.OPSMART_STORE.getByName("primary");
      return store.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },

  scheduled(
    _controller: { cron?: string; scheduledTime?: number },
    env: Env,
    context: WorkerContext,
  ) {
    context.waitUntil(
      env.OPSMART_STORE.getByName("primary")
        .runNotificationTick()
        .catch((error: unknown) => {
          console.error("Notification worker tick failed", {
            message: String(error),
          });
        }),
    );
  },
};

export { OpSmartStore };
export default worker;
