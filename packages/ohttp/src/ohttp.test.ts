import { expect, test } from "bun:test";
import { DhkemX25519HkdfSha256 } from "@hpke/dhkem-x25519";
import {
  decapsulateRequest, decodeKeyConfig, decodeRequest, decodeResponse, encapsulateRequest, encodeKeyConfig,
  encodeRequest, encodeResponse, generateGatewayKey, hex, unhex,
} from ".";

// RFC 9458 Appendix A.
const V = {
  skR: "3c168975674b2fa8e465970b79c8dcf09f1c741626480bd4c6162fc5b6a98e1a",
  keyConfig: "01002031e1f05a740102115220e9af918f738674aec95f54db6e04eb705aae8e79815500080001000100010003",
  skE: "bc51d5e930bda26589890ac7032f70ad12e4ecb37abb1b65b1256c9c48999c73",
  pkE: "4b28f881333e7c164ffc499ad9796f877f4e1051ee6d31bad19dec96c208b472",
  request: "00034745540568747470730b6578616d706c652e636f6d012f",
  encapsulated:
    "010020000100014b28f881333e7c164ffc499ad9796f877f4e1051ee6d31bad19dec96c208b4726374e469135906992e1268c594d2a10c695d858c40a026e7965e7d86b83dd440b2c0185204b4d63525",
  response: "0140c8",
  responseNonce: "c789e7151fcba46158ca84b04464910d",
  encapsulatedResponse: "c789e7151fcba46158ca84b04464910d86f9013e404feea014e7be4a441f234f857fbd",
};

test("RFC 9458 Appendix A: request and response match byte for byte", async () => {
  const cfg = decodeKeyConfig(unhex(V.keyConfig));
  const kem = new DhkemX25519HkdfSha256();
  const buf = (h: string) => unhex(h).buffer as ArrayBuffer;
  const ekm = { privateKey: await kem.importKey("raw", buf(V.skE), false), publicKey: await kem.importKey("raw", buf(V.pkE), true) };
  const client = await encapsulateRequest(cfg, unhex(V.request), ekm);
  expect(hex(client.request)).toBe(V.encapsulated);

  const gw = await decapsulateRequest({ keyId: 1, privateKey: unhex(V.skR), publicKey: cfg.publicKey }, client.request);
  expect(hex(gw.request)).toBe(V.request);
  const sealed = await gw.sealResponse(unhex(V.response), unhex(V.responseNonce));
  expect(hex(sealed)).toBe(V.encapsulatedResponse);
  expect(hex(await client.openResponse(sealed))).toBe(V.response);

  // The vector's truncated Binary HTTP decodes.
  expect(decodeRequest(unhex(V.request))).toMatchObject({ method: "GET", scheme: "https", authority: "example.com", path: "/" });
  expect(decodeResponse(unhex(V.response)).status).toBe(200);
});

test("round trip with a fresh key, headers and bodies", async () => {
  const key = await generateGatewayKey(7);
  const cfg = decodeKeyConfig(encodeKeyConfig(key));
  const body = new TextEncoder().encode(JSON.stringify({ hello: "foil" }));
  const client = await encapsulateRequest(cfg, encodeRequest({
    method: "POST", scheme: "https", authority: "api.foil", path: "/trpc/status", headers: [["content-type", "application/json"]], body,
  }));
  const gw = await decapsulateRequest(key, client.request);
  const req = decodeRequest(gw.request);
  expect(req.path).toBe("/trpc/status");
  expect(req.headers).toEqual([["content-type", "application/json"]]);
  expect(new TextDecoder().decode(req.body)).toBe('{"hello":"foil"}');
  const res = decodeResponse(await client.openResponse(await gw.sealResponse(encodeResponse({ status: 201, headers: [], body: Uint8Array.of(1, 2, 3) }))));
  expect(res.status).toBe(201);
  expect([...res.body]).toEqual([1, 2, 3]);
});

test("tampering fails closed", async () => {
  const key = await generateGatewayKey();
  const client = await encapsulateRequest(key, encodeRequest({ method: "GET", scheme: "https", authority: "a", path: "/", headers: [], body: new Uint8Array() }));
  const bad = client.request.slice();
  bad[bad.length - 1]! ^= 1;
  await expect(decapsulateRequest(key, bad)).rejects.toThrow();
  const gw = await decapsulateRequest(key, client.request);
  const sealed = await gw.sealResponse(Uint8Array.of(1, 0x40, 0xc8));
  sealed[20]! ^= 1;
  await expect(client.openResponse(sealed)).rejects.toThrow();
});
