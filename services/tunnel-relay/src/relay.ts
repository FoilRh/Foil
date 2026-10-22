/**
 * Tunnel relay (Build §1, §5A.1, §8): an HTTP CONNECT proxy for pack-site and shipping
 * traffic. It only opens tunnels to allowlisted hosts on port 443 and never terminates
 * their TLS: it sees the client's IP and an encrypted byte stream, while the site sees
 * only the relay. DNS is resolved here, not on the client. No logs, no state.
 */
import type { Socket, TCPSocketListener } from "bun";

export interface TunnelOptions {
  port: number;
  hostname?: string;
  /** Hostnames a tunnel may reach (exact match or subdomain). */
  allowedHosts: string[];
  /** Ports a tunnel may reach; 443 in production (tests use a local port). */
  allowedPorts?: number[];
  /** Test hook: where to actually connect for an allowed host (default: the host itself). */
  resolve?: (host: string) => string;
}

type Conn = { upstream?: Socket<unknown>; buffered: Uint8Array[]; header: string; open: boolean };
const MAX_HEADER = 8 * 1024;

/** True if `host` (case-insensitive, trailing dot ignored) equals or is a subdomain of an allowed host. */
export function hostAllowed(host: string, allowed: string[]) {
  const h = host.toLowerCase().replace(/\.$/, "");
  return allowed.some((a) => h === a || h.endsWith(`.${a}`));
}

/**
 * Starts the CONNECT proxy: parses the request header (≤ 8 KiB), refuses non-allowlisted
 * host:port with 403, then pipes bytes both ways without touching TLS.
 */
export function startTunnel(o: TunnelOptions): TCPSocketListener<Conn> {
  const ports = o.allowedPorts ?? [443];
  return Bun.listen<Conn>({
    hostname: o.hostname ?? "0.0.0.0",
    port: o.port,
    socket: {
      open(s) {
        s.data = { buffered: [], header: "", open: false };
      },
      async data(s, chunk) {
        const c = s.data;
        if (c.open) {
          c.upstream?.write(chunk);
          return;
        }
        if (c.upstream) {
          c.buffered.push(new Uint8Array(chunk)); // early bytes while the upstream connects
          return;
        }
        c.header += new TextDecoder().decode(chunk);
        if (c.header.length > MAX_HEADER) return void s.end("HTTP/1.1 431 Request Header Fields Too Large\r\n\r\n");
        const end = c.header.indexOf("\r\n\r\n");
        if (end < 0) return;
        const m = /^CONNECT ([^\s:]+):(\d+) HTTP\/1\.[01]\r\n/.exec(c.header);
        if (!m) return void s.end("HTTP/1.1 405 Method Not Allowed\r\n\r\n");
        const host = m[1]!;
        const port = Number(m[2]);
        if (!hostAllowed(host, o.allowedHosts) || !ports.includes(port)) return void s.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        // Anything after the header (rare: client pipelined the TLS hello) is forwarded too.
        const rest = new TextEncoder().encode(c.header.slice(end + 4));
        if (rest.length) c.buffered.push(rest);
        try {
          c.upstream = await Bun.connect<undefined>({
            hostname: o.resolve ? o.resolve(host) : host,
            port,
            socket: {
              data: (_u, d) => void s.write(d),
              close: () => void s.end(),
              error: () => void s.end(),
            },
          });
        } catch {
          return void s.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        }
        s.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        c.open = true;
        for (const b of c.buffered) c.upstream.write(b);
        c.buffered = [];
      },
      close(s) {
        s.data.upstream?.end();
      },
      error(s) {
        s.data.upstream?.end();
      },
    },
  });
}
