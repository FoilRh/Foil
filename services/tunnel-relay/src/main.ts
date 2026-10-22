/** Fly.io service. Env: PORT (default 8080), ALLOWED_HOSTS (comma-separated; default the CC pack domains). */
import { startTunnel } from "./relay";

const allowedHosts = (process.env.ALLOWED_HOSTS ?? "collectorcrypt.com,thecardwall.com").split(",").map((h) => h.trim()).filter(Boolean);
const t = startTunnel({ port: Number(process.env.PORT ?? 8080), allowedHosts });
console.log(`[tunnel-relay] :${t.port} → ${allowedHosts.join(", ")}:443`);
