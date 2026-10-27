// Trusted timestamps (RFC 3161): the query Tattle sends, and what it reads from an authority's reply.
// See docs/recordings.md § Proof of a recording.
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { der, readTimestampReply, requestTimestamps, TIMESTAMP_AUTHORITIES, timestampQuery } from "../src/store/timestamp.ts";
import { fakeTimestampFetch, parseQuery, timestampReply } from "./fakes/timestamp.ts";
import { networkError } from "./fakes/index.ts";

const hash = createHash("sha256").update("hello").digest();
const nonce = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x01]);

describe("der", () => {
  test("short and long lengths", () => {
    expect(der(0x04, Buffer.from([1, 2]))).toEqual(Buffer.from([0x04, 0x02, 1, 2]));
    const long = der(0x04, Buffer.alloc(200));
    expect([...long.subarray(0, 3)]).toEqual([0x04, 0x81, 200]);
    expect([...der(0x04, Buffer.alloc(300)).subarray(0, 4)]).toEqual([0x04, 0x82, 0x01, 0x2c]);
  });
});

describe("timestampQuery", () => {
  test("a version-1 TimeStampReq: SHA-256 imprint, the nonce, and a request for the authority's certificate", () => {
    const q = timestampQuery(hash, nonce);
    expect(q.toString("hex")).toBe(
      "3043" + "020101" + "3031" + "300d0609608648016503040201" + "0500" + "0420" + hash.toString("hex") +
      "0208" + nonce.toString("hex") + "0101ff");
    expect(parseQuery(q)).toEqual({ hash, nonce });
  });

  test("refuses anything but a SHA-256 hash", () => {
    expect(() => timestampQuery(Buffer.alloc(20), nonce)).toThrow("a SHA-256 hash is 32 bytes");
  });
});

describe("readTimestampReply", () => {
  test("a granted reply: the token, and the time it certifies (not a certificate's date)", () => {
    const reply = timestampReply({ hash, nonce, genTime: "20261027040531.25Z" });
    const r = readTimestampReply(reply, hash, nonce);
    expect(r.genTime).toBe("2026-10-27T04:05:31.250Z");
    expect(reply.subarray(reply.length - r.token.length).equals(r.token)).toBe(true);
    expect(r.token[0]).toBe(0x30);
  });

  test("granted with modifications is granted too", () => {
    expect(readTimestampReply(timestampReply({ hash, nonce, status: 1 }), hash, nonce).genTime).toBe("2026-10-27T04:05:31.000Z");
  });

  test("refuses a rejection, another hash, another nonce, and what is not DER", () => {
    expect(() => readTimestampReply(timestampReply({ hash, nonce, status: 2 }), hash, nonce)).toThrow("the authority refused it (status 2)");
    const other = createHash("sha256").update("other").digest();
    expect(() => readTimestampReply(timestampReply({ hash: other, nonce }), hash, nonce)).toThrow("the token is for another hash");
    expect(() => readTimestampReply(timestampReply({ hash, nonce: Buffer.from([9]) }), hash, nonce)).toThrow("the token answers another request");
    expect(() => readTimestampReply(Buffer.from("<html>busy</html>"), hash, nonce)).toThrow("not a timestamp reply");
    expect(() => readTimestampReply(Buffer.from([0x30, 0x05, 0x30]), hash, nonce)).toThrow("not a timestamp reply");
    // granted, but no time in it
    const noTime = der(0x30, der(0x30, der(0x02, Buffer.from([0]))), der(0x30, der(0x04, hash), der(0x02, nonce)));
    expect(() => readTimestampReply(noTime, hash, nonce)).toThrow("the token has no time");
  });
});

describe("readTimestampReply refuses malformed DER", () => {
  const bad = (b: Buffer) => () => readTimestampReply(b, hash, nonce);
  test.each([
    ["a lone tag", Buffer.from([0x30])],
    ["a long length of 0 bytes", Buffer.from([0x30, 0x80])],
    ["a long length of 5 bytes", Buffer.from([0x30, 0x85, 1, 1, 1, 1, 1])],
    ["a long length cut short", Buffer.from([0x30, 0x82, 0x01])],
    ["two top-level elements", Buffer.concat([der(0x30), der(0x30)])],
    ["a top level that is not a SEQUENCE", der(0x02, Buffer.from([0]))],
    ["no status", der(0x30)],
    ["a status that is not a SEQUENCE", der(0x30, der(0x02, Buffer.from([0])))],
    ["a status without its INTEGER", der(0x30, der(0x30, der(0x04, Buffer.from([0]))))],
    ["granted, but no token", der(0x30, der(0x30, der(0x02, Buffer.from([0]))))],
  ])("%s", (_name, b) => {
    expect(bad(b)).toThrow("not a timestamp reply");
  });

  test("a time it cannot read; a damaged inner element is skipped while looking for the time", () => {
    expect(bad(timestampReply({ hash, nonce, genTime: "2026-10-27" }))).toThrow("the token's time is not readable");
    const reply = der(0x30, der(0x30, der(0x02, Buffer.from([0]))),
      der(0x30, der(0x04, Buffer.from([0x30, 0x05])), der(0x04, hash), der(0x02, nonce), der(0x18, Buffer.from("20261027040531Z"))));
    expect(readTimestampReply(reply, hash, nonce).genTime).toBe("2026-10-27T04:05:31.000Z");
  });
});

describe("requestTimestamps", () => {
  test("three independent authorities, by default", () => {
    expect(TIMESTAMP_AUTHORITIES.map((a) => a.name)).toEqual(["DigiCert", "GlobalSign", "FreeTSA"]);
  });

  test("asks every authority at once, as a timestamp query; keeps the tokens, and says why the others failed", async () => {
    const f = fakeTimestampFetch((url, q) => {
      if (url.includes("globalsign")) throw networkError();
      if (url.includes("freetsa")) return new Response("busy", { status: 503 });
      return timestampReply(q);
    });
    const r = await requestTimestamps(hash, { fetch: f });
    expect(f.calls.map((c) => [c.url, c.contentType, c.hash.equals(hash)])).toEqual(
      TIMESTAMP_AUTHORITIES.map((a) => [a.url, "application/timestamp-query", true]));
    expect(r.tokens).toEqual([{ authority: "DigiCert", url: TIMESTAMP_AUTHORITIES[0].url, genTime: "2026-10-27T04:05:31.000Z", token: expect.any(String) }]);
    expect(Buffer.from(r.tokens[0].token, "base64")[0]).toBe(0x30);
    expect(r.failures).toEqual([
      { authority: "GlobalSign", url: TIMESTAMP_AUTHORITIES[1].url, error: expect.any(String) },
      { authority: "FreeTSA", url: TIMESTAMP_AUTHORITIES[2].url, error: "HTTP 503" },
    ]);
  });

  test("what a fetch throws that is not an Error is kept as text", async () => {
    const odd = (() => Promise.reject("refused")) as unknown as typeof fetch;
    expect((await requestTimestamps(hash, { fetch: odd, authorities: [{ name: "A", url: "http://a" }] })).failures[0].error).toBe("refused");
  });

  test("a reply that is not a token, and an authority that does not answer in time, are failures", async () => {
    const slow = fakeTimestampFetch(() => Buffer.from("nope"));
    const r = await requestTimestamps(hash, { fetch: slow, authorities: [{ name: "A", url: "http://a" }] });
    expect(r).toEqual({ tokens: [], failures: [{ authority: "A", url: "http://a", error: "not a timestamp reply" }] });
    const hang = ((_u: string, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as typeof fetch;
    const t = await requestTimestamps(hash, { fetch: hang, authorities: [{ name: "B", url: "http://b" }], timeoutMs: 20 });
    expect(t.failures).toEqual([{ authority: "B", url: "http://b", error: "aborted" }]);
  });
});
