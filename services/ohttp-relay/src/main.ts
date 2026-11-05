/** Relay service (Vercel or Fly). Env: GATEWAY_URL, ALLOWED_ORIGINS (comma-separated), GATEWAY_TOKEN (shared with the API), PORT. */
import { z } from "zod";
import { createRelay, platformIp } from "./relay";

const env = z
  .object({
    GATEWAY_URL: z.url(),
    ALLOWED_ORIGINS: z.string().transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
    GATEWAY_TOKEN: z.string().min(32).optional(),
    PORT: z.coerce.number().default(8080),
  })
  .parse(process.env);

export const handle = createRelay({
  gatewayUrl: env.GATEWAY_URL, allowedOrigins: env.ALLOWED_ORIGINS, gatewayToken: env.GATEWAY_TOKEN,
  ipOf: platformIp(process.env),
});
export default { port: env.PORT, fetch: handle };
