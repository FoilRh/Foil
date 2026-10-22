/** Fly.io service. Env: GATEWAY_URL, ALLOWED_ORIGINS (comma-separated), PORT. */
import { z } from "zod";
import { createRelay } from "./relay";

const env = z
  .object({
    GATEWAY_URL: z.url(),
    ALLOWED_ORIGINS: z.string().transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
    PORT: z.coerce.number().default(8080),
  })
  .parse(process.env);

export const handle = createRelay({ gatewayUrl: env.GATEWAY_URL, allowedOrigins: env.ALLOWED_ORIGINS });
export default { port: env.PORT, fetch: handle };
