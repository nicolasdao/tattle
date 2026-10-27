// Trusted timestamps (RFC 3161): an independent authority signs "this hash existed at this time". Only the 32-byte
// SHA-256 hash leaves the Mac, never a word or a sound of the recording. Free public authorities, no account; each
// token can be checked with `openssl ts -verify` against the authority's root certificate, without Tattle.
// See docs/recordings.md § Proof of a recording.
import { randomBytes } from "node:crypto";

export interface TimestampAuthority { name: string; url: string }
/**
 * Three independent authorities in three countries (United States, Belgium, Germany): if one is down, retires, or is
 * later distrusted, the others still stand. Each one's tokens were checked with `openssl ts -verify` (OpenSSL 3);
 * Sectigo's were not used because OpenSSL 3 rejects them ("ess cert id not found").
 */
export const TIMESTAMP_AUTHORITIES: TimestampAuthority[] = [
  { name: "DigiCert", url: "http://timestamp.digicert.com" },
  { name: "GlobalSign", url: "http://timestamp.globalsign.com/tsa/r6advanced1" },
  { name: "FreeTSA", url: "https://freetsa.org/tsr" },
];

/** A token as kept in a seal: `token` is the DER TimeStampToken, base64. */
export interface TimestampToken { authority: string; url: string; genTime: string; token: string }
export interface TimestampFailure { authority: string; url: string; error: string }

export class TimestampError extends Error {}

/** One DER element: its tag, then its length (short or long form), then the contents. */
export function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const n = body.length;
  const len = n < 0x80 ? Buffer.from([n]) : (() => {
    const bytes: number[] = [];
    for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
    return Buffer.from([0x80 | bytes.length, ...bytes]);
  })();
  return Buffer.concat([Buffer.from([tag]), len, body]);
}

const SHA256_ALGORITHM = der(0x30, Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]), Buffer.from([0x05, 0x00]));

/** A TimeStampReq (version 1) for a SHA-256 hash, with a nonce, asking for the authority's certificate in the token. */
export function timestampQuery(sha256: Buffer, nonce: Buffer): Buffer {
  if (sha256.length !== 32) throw new TimestampError("a SHA-256 hash is 32 bytes");
  return der(0x30,
    der(0x02, Buffer.from([1])),
    der(0x30, SHA256_ALGORITHM, der(0x04, sha256)),
    der(0x02, nonce),
    der(0x01, Buffer.from([0xff])));
}

interface Tlv { tag: number; start: number; contentStart: number; end: number }

/** The elements at one level of `buf[from, to)`; throws on a length that runs past the end. */
function children(buf: Buffer, from: number, to: number): Tlv[] {
  const out: Tlv[] = [];
  let p = from;
  while (p < to) {
    if (p + 2 > to) throw new TimestampError("not a timestamp reply");
    const tag = buf[p];
    let len = buf[p + 1];
    let q = p + 2;
    if (len & 0x80) {
      const k = len & 0x7f;
      if (k === 0 || k > 4 || q + k > to) throw new TimestampError("not a timestamp reply");
      len = 0;
      for (let i = 0; i < k; i++) len = len * 256 + buf[q + i];
      q += k;
    }
    if (q + len > to) throw new TimestampError("not a timestamp reply");
    out.push({ tag, start: p, contentStart: q, end: q + len });
    p = q + len;
  }
  return out;
}

/** The first GeneralizedTime in document order: TSTInfo's genTime, which comes before the certificates. */
function firstGeneralizedTime(buf: Buffer, from: number, to: number): string | null {
  let items: Tlv[];
  try { items = children(buf, from, to); } catch { return null; }
  for (const t of items) {
    if (t.tag === 0x18) return buf.toString("ascii", t.contentStart, t.end);
    // constructed elements, and the OCTET STRING that wraps TSTInfo
    if (t.tag & 0x20 || (t.tag === 0x04 && buf[t.contentStart] === 0x30)) {
      const found = firstGeneralizedTime(buf, t.contentStart, t.end);
      if (found) return found;
    }
  }
  return null;
}

/** 20261027040531Z or 20261027040531.25Z → an ISO date. */
function isoTime(g: string): string {
  const m = g.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/);
  if (!m) throw new TimestampError("the token's time is not readable");
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? ""}Z`).toISOString();
}

/**
 * Reads a TimeStampResp: the status must be granted, and the token must carry this hash and this nonce. Returns the
 * token (DER) and the time it certifies. The authority's signature is not checked here: `openssl ts -verify` does
 * that against its root certificate (see the transcript's verification steps).
 */
export function readTimestampReply(reply: Buffer, sha256: Buffer, nonce: Buffer): { token: Buffer; genTime: string } {
  const top = children(reply, 0, reply.length);
  if (top.length !== 1 || top[0].tag !== 0x30) throw new TimestampError("not a timestamp reply");
  const [statusInfo, token] = children(reply, top[0].contentStart, top[0].end);
  if (!statusInfo || statusInfo.tag !== 0x30) throw new TimestampError("not a timestamp reply");
  const status = children(reply, statusInfo.contentStart, statusInfo.end)[0];
  if (!status || status.tag !== 0x02) throw new TimestampError("not a timestamp reply");
  const code = reply.readUIntBE(status.contentStart, Math.min(6, status.end - status.contentStart));
  if (code > 1) throw new TimestampError(`the authority refused it (status ${code})`);
  if (!token) throw new TimestampError("not a timestamp reply");
  const bytes = Buffer.from(reply.subarray(token.start, token.end));
  if (!bytes.includes(sha256)) throw new TimestampError("the token is for another hash");
  if (!bytes.includes(der(0x02, nonce))) throw new TimestampError("the token answers another request");
  const g = firstGeneralizedTime(bytes, 0, bytes.length);
  if (!g) throw new TimestampError("the token has no time");
  return { token: bytes, genTime: isoTime(g) };
}

/** A positive 8-byte INTEGER: the top bit clear, and never a leading zero byte. */
function newNonce(): Buffer {
  const n = randomBytes(8);
  n[0] = (n[0] & 0x7f) | 0x01;
  return n;
}

/**
 * Asks every authority at once. Never throws: what one authority could not give is a failure with its reason, so a
 * seal is made whether the Mac is online or not.
 */
export async function requestTimestamps(
  sha256: Buffer, opts: { fetch: typeof fetch; authorities?: TimestampAuthority[]; timeoutMs?: number },
): Promise<{ tokens: TimestampToken[]; failures: TimestampFailure[] }> {
  const results = await Promise.all((opts.authorities ?? TIMESTAMP_AUTHORITIES).map(async (a) => {
    const nonce = newNonce();
    try {
      const res = await opts.fetch(a.url, {
        method: "POST", headers: { "content-type": "application/timestamp-query" },
        body: new Uint8Array(timestampQuery(sha256, nonce)), signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      });
      if (!res.ok) throw new TimestampError(`HTTP ${res.status}`);
      const { token, genTime } = readTimestampReply(Buffer.from(await res.arrayBuffer()), sha256, nonce);
      return { ok: true as const, t: { authority: a.name, url: a.url, genTime, token: token.toString("base64") } };
    } catch (e) {
      return { ok: false as const, f: { authority: a.name, url: a.url, error: e instanceof Error ? e.message : String(e) } };
    }
  }));
  return {
    tokens: results.flatMap((r) => (r.ok ? [r.t] : [])),
    failures: results.flatMap((r) => (r.ok ? [] : [r.f])),
  };
}
