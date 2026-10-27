import { der } from "../../src/store/timestamp.ts";

// A timestamp authority (RFC 3161) as `fetch`: it answers each query with a reply shaped like a real one (a granted
// status and a token whose TSTInfo carries the query's hash, its nonce, and `genTime`). The token is not signed: tests
// check what Tattle reads from it, never the authority's signature, which only `openssl ts -verify` can check.

const SHA256_OID = Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
const SIGNED_DATA_OID = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
const TST_INFO_OID = Buffer.from([0x06, 0x0b, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x10, 0x01, 0x04]);

/** The hash and nonce of a TimeStampReq, as `timestampQuery` writes it. */
export function parseQuery(q: Buffer): { hash: Buffer; nonce: Buffer } {
  const hashAt = q.indexOf(Buffer.from([0x04, 0x20]));
  const hash = q.subarray(hashAt + 2, hashAt + 34);
  const nonceLen = q[hashAt + 35];
  return { hash, nonce: q.subarray(hashAt + 36, hashAt + 36 + nonceLen) };
}

/** A TimeStampResp: `status` 0 is granted; `hash` defaults to the query's. */
export function timestampReply(o: { hash: Buffer; nonce: Buffer; genTime?: string; status?: number }): Buffer {
  const tstInfo = der(0x30,
    der(0x02, Buffer.from([1])), Buffer.from([0x06, 0x03, 0x2a, 0x03, 0x04]),
    der(0x30, der(0x30, SHA256_OID, Buffer.from([0x05, 0x00])), der(0x04, o.hash)),
    der(0x02, Buffer.from([0x2a])), der(0x18, Buffer.from(o.genTime ?? "20261027040531Z", "ascii")), der(0x02, o.nonce));
  const token = der(0x30, SIGNED_DATA_OID, der(0xa0, der(0x30,
    der(0x02, Buffer.from([3])), der(0x31),
    der(0x30, TST_INFO_OID, der(0xa0, der(0x04, tstInfo))),
    // a certificate's validity comes after, as UTCTime and, past 2049, GeneralizedTime: never read as the time
    der(0xa0, der(0x30, der(0x18, Buffer.from("20991231235959Z", "ascii")))))));
  return der(0x30, der(0x30, der(0x02, Buffer.from([o.status ?? 0]))), ...(o.status && o.status > 1 ? [] : [token]));
}

/**
 * A `fetch` for timestamp authorities: `answer(url, query)` returns a reply (or a Response, or throws); by default every
 * authority grants it. `calls` records each URL and query.
 */
export function fakeTimestampFetch(answer?: (url: string, q: { hash: Buffer; nonce: Buffer }) => Buffer | Response) {
  const calls: { url: string; contentType: string | null; hash: Buffer }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = Buffer.from(init?.body as Uint8Array);
    const q = parseQuery(body);
    calls.push({ url, contentType: new Headers(init?.headers).get("content-type"), hash: q.hash });
    const r = answer ? answer(url, q) : timestampReply(q);
    if (r instanceof Response) return r;
    return new Response(new Uint8Array(r), { status: 200, headers: { "content-type": "application/timestamp-reply" } });
  }) as typeof fetch;
  return Object.assign(f, { calls });
}
