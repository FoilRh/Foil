import { expect, test } from "bun:test";
import { scan } from "./privacy-lint";

test("client fetch is only allowed inside the transport", () => {
  expect(scan("apps/web/src/x.tsx", "await fetch('/x')")).toHaveLength(1);
  expect(scan("packages/client/src/notes.ts", "new WebSocket(u)")).toHaveLength(1);
  expect(scan("packages/client/src/transport/ohttp.ts", "await fetch(relay)")).toHaveLength(0);
  expect(scan("apps/web/src/x.tsx", "// fetch( in a comment")).toHaveLength(0);
});

test("servers never read IPs or user agents", () => {
  expect(scan("apps/api/src/app.ts", "c.req.header('x-forwarded-for')")).toHaveLength(1);
  expect(scan("services/relayer/src/main.ts", "log(req.ip)")).toHaveLength(1);
  expect(scan("services/relayer/src/main.ts", "const tip = 1")).toHaveLength(0);
});
