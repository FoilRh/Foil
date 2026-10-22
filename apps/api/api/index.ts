// Vercel entry: every path is handled by the Hono app (see vercel.json rewrites).
import { handle } from "hono/vercel";
import { appFromEnv } from "../src/index";

const app = appFromEnv();
export const GET = handle(app);
export const POST = handle(app);
