import type { Database } from "../../server/db.js";
import { expireAndPurgeKnowledgeSources } from "./service.js";

const INTERVAL_MS = 15 * 60 * 1000;

export function startKnowledgeRetentionWorker(db: Database): () => void {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await expireAndPurgeKnowledgeSources(db);
    } catch {
      console.error("Knowledge source retention tick failed");
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(() => void run(), INTERVAL_MS);
    }
  };
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
