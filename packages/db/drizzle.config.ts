import { defineConfig } from "drizzle-kit";

// Generated SQL lands in supabase/migrations; apply with the Supabase CLI or MCP.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "../../supabase/migrations",
  migrations: { prefix: "timestamp" },
});
