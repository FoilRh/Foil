import { afterAll, beforeAll, expect, test } from "bun:test";
import { hostAllowed, startTunnel } from "./relay";

// A stand-in "site": echoes bytes back, prefixed, so we can see they went end to end.
let site: { port: number; stop(force?: boolean): void };
let tunnel: ReturnType<typeof startTunnel>;
beforeAll(() => {
  site = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: (s, d) => void s.write(`echo:${new TextDecoder().decode(d)}`) } });
  tunnel = startTunnel({
    hostname: "127.0.0.1", port: 0, allowedHosts: ["collectorcrypt.com"], allowedPorts: [site.port],
    resolve: () => "127.0.0.1",
  });
});
afterAll(() => {
  site.stop(true);
  tunnel.stop(true);
});

async function talk(lines: string, then?: string): Promise<string> {
  let out = "";
  let resolveDone: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));
  const sock = await Bun.connect({
    hostname: "127.0.0.1", port: tunnel.port,
    socket: {
      data: (s, d) => {
        out += new TextDecoder().decode(d);
        if (then && out.includes("200 Connection Established") && !out.includes("echo:")) s.write(then);
        if (!then || out.includes("echo:")) resolveDone();
      },
      close: () => resolveDone(),
    },
  });
  sock.write(lines);
  await Promise.race([done, Bun.sleep(3000)]);
  sock.end();
  return out;
}

test("hosts: exact or subdomain of an allowed host only", () => {
  expect(hostAllowed("gacha.collectorcrypt.com", ["collectorcrypt.com"])).toBe(true);
  expect(hostAllowed("collectorcrypt.com.", ["collectorcrypt.com"])).toBe(true);
  expect(hostAllowed("evilcollectorcrypt.com", ["collectorcrypt.com"])).toBe(false);
  expect(hostAllowed("collectorcrypt.com.evil.io", ["collectorcrypt.com"])).toBe(false);
});

test("an allowed CONNECT opens a byte tunnel (TLS would pass through untouched)", async () => {
  const out = await talk(`CONNECT gacha.collectorcrypt.com:${site.port} HTTP/1.1\r\nHost: gacha.collectorcrypt.com\r\n\r\n`, "hello");
  expect(out).toContain("HTTP/1.1 200 Connection Established");
  expect(out).toContain("echo:hello");
});

test("other hosts, other ports and plain HTTP are refused", async () => {
  expect(await talk(`CONNECT evil.example:${site.port} HTTP/1.1\r\n\r\n`)).toContain("403");
  expect(await talk("CONNECT gacha.collectorcrypt.com:22 HTTP/1.1\r\n\r\n")).toContain("403");
  expect(await talk("GET http://collectorcrypt.com/ HTTP/1.1\r\nHost: collectorcrypt.com\r\n\r\n")).toContain("405");
});
