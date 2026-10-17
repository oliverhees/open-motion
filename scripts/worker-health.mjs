// Docker healthcheck for the render worker: its heartbeat file must be fresh.
import { readFileSync } from "node:fs";
import path from "node:path";
try {
  const w = JSON.parse(readFileSync(path.join(process.env.OPENMOTION_DATA ?? "data", "worker.json"), "utf8"));
  process.exit(Date.now() - Date.parse(w.at) < 60_000 ? 0 : 1);
} catch {
  process.exit(1);
}
