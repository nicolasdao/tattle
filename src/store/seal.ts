// The seal of a recording, made when it ends (or, for a recording from before seals, at its first export): a frozen
// copy of its transcript, the SHA-256 fingerprints of the files that never change after a recording ends, signed with
// this Mac's own key, and timestamped by independent authorities when trusted timestamps are on. It proves the files
// are unchanged since then, and (with a timestamp) that they existed then; not who spoke, nor that recognition was right.
// See docs/recordings.md § Proof of a recording.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { appSupportDir } from "../paths.ts";
import type { TimestampFailure, TimestampToken } from "./timestamp.ts";

export const SEAL_FILE = "seal.json";
/** The transcript as it was when sealed: one line per utterance, never rewritten afterwards. */
export const TRANSCRIPT_FILE = "transcript.jsonl";
/** What a seal covers, when present. Not events.jsonl, speakers.json or meta.json: renames and chats change them later. */
const SEALED_FILES = ["host.wav", "remote.wav", TRANSCRIPT_FILE, "utterances.jsonl", "transcriptions.jsonl"];

/** tests override it */
export function signingKeyPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.TATTLE_SIGNING_KEY || join(appSupportDir(), "signing-key.json");
}

/** SHA-256 of a public key (SPKI DER, base64), as 16 groups of 4 hex digits. */
export function keyFingerprint(publicKey: string): string {
  return createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex").toUpperCase().match(/.{4}/g)!.join(" ");
}

/**
 * This Mac's signing key: ECDSA P-256 with SHA-256, which every openssl (LibreSSL on macOS included) can verify.
 * Made on first use, kept next to the saved API keys, readable only by the user. It identifies this Tattle install,
 * not a person: whoever relies on it learns its fingerprint from the recorder.
 */
export class SigningKey {
  readonly publicKey: string;
  readonly fingerprint: string;

  private constructor(private readonly key: KeyObject) {
    this.publicKey = createPublicKey(key).export({ type: "spki", format: "der" }).toString("base64");
    this.fingerprint = keyFingerprint(this.publicKey);
  }

  static load(path = signingKeyPath()): SigningKey {
    if (existsSync(path)) {
      try {
        return new SigningKey(createPrivateKey(JSON.parse(readFileSync(path, "utf8")).privateKey));
      } catch {
        // never replaced: a new key would make everything sealed so far look signed by someone else
        throw new Error(`the signing key ${path} cannot be read: move it aside to make a new one`);
      }
    }
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({
      algorithm: "ECDSA P-256 SHA-256", createdAt: new Date().toISOString(),
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
    }, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, path);
    return new SigningKey(privateKey);
  }

  /** A DER signature, base64. */
  sign(data: string | Buffer): string {
    return sign("sha256", Buffer.from(data), this.key).toString("base64");
  }
}

export function verifySignature(data: string | Buffer, signature: string, publicKey: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });
    return verify("sha256", Buffer.from(data), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

export interface SealPayload {
  format: "tattle-seal";
  version: 1;
  /** `ended`: sealed as the recording ended; `export`: a recording from before seals, sealed at its first export. */
  when: "ended" | "export";
  sealedAt: string;
  app: { name: string; version: string };
  recording: { id: string; startedAt: string | null; mode: string; recordedWith: string | null; durationMs: number };
  /** The signing key's fingerprint. */
  key: string;
  files: { name: string; bytes: number; sha256: string }[];
}

/**
 * `payload` is kept as the exact string that was signed and timestamped, so it never needs re-serialising to check.
 * Timestamps sit outside it: each token signs the payload's hash on its own, and can be added later.
 */
export interface Seal {
  payload: string;
  signature: string;
  publicKey: string;
  timestamps: TimestampToken[];
  timestampFailures?: TimestampFailure[];
}

export interface SealedLine {
  id: string; stream: string; startMs: number; endMs: number; speakerId: string;
  /** The speaker's name when the recording was sealed. */
  speaker: string;
  text: string;
  filler?: true;
}

export type Stamp = (sha256: Buffer) => Promise<{ tokens: TimestampToken[]; failures: TimestampFailure[] }>;

const readJson = (p: string) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

export async function sha256File(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}

/** Every line spoken, from the recording's events: the last version of each utterance, in the order they were said. */
function transcriptLines(dir: string): SealedLine[] {
  const names = new Map<string, string>((readJson(join(dir, "speakers.json")) ?? []).map((s: any) => [s.id, s.displayName]));
  const byId = new Map<string, any>();
  const path = join(dir, "events.jsonl");
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const line of text.split("\n")) {
    if (!line.includes('"type":"utterance"')) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; } // a torn last line
    const d = e?.data;
    if (e?.type !== "utterance" || typeof d?.id !== "string") continue;
    byId.delete(d.id); // a retried line takes the place of its first try
    byId.set(d.id, d);
  }
  return [...byId.values()]
    .filter((d) => typeof d.text === "string" && d.text.trim())
    .sort((a, b) => a.startMs - b.startMs)
    .map((d) => ({
      id: d.id, stream: d.stream, startMs: d.startMs, endMs: d.endMs, speakerId: d.speakerId,
      speaker: names.get(d.speakerId) ?? d.speakerName, text: d.text, ...(d.filler ? { filler: true as const } : {}),
    }));
}

/** The frozen transcript of a sealed recording. */
export function sealedTranscript(dir: string): SealedLine[] {
  const path = join(dir, TRANSCRIPT_FILE);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export function readSeal(dir: string): Seal | null {
  const s = readJson(join(dir, SEAL_FILE));
  return s && typeof s.payload === "string" && typeof s.signature === "string" ? s : null;
}

function writeSeal(dir: string, seal: Seal) {
  const path = join(dir, SEAL_FILE);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(seal, null, 2) + "\n");
  renameSync(tmp, path);
}

export interface SealOptions {
  key: SigningKey;
  app: { name: string; version: string };
  /** Trusted timestamps; without it, the seal is signed but not timestamped. */
  stamp?: Stamp;
  now?: () => Date;
}

/** Seals a recording: freezes its transcript, fingerprints its files, signs, timestamps, and writes seal.json. */
export async function sealRecording(dir: string, opts: SealOptions & { when: SealPayload["when"] }): Promise<Seal> {
  const session = readJson(join(dir, "session.json")) ?? {};
  writeFileSync(join(dir, TRANSCRIPT_FILE), transcriptLines(dir).map((l) => JSON.stringify(l) + "\n").join(""));
  const files: SealPayload["files"] = [];
  for (const name of SEALED_FILES) {
    const p = join(dir, name);
    if (existsSync(p)) files.push({ name, bytes: statSync(p).size, sha256: await sha256File(p) });
  }
  const wavs = files.filter((f) => f.name.endsWith(".wav"));
  const payload: SealPayload = {
    format: "tattle-seal", version: 1, when: opts.when, sealedAt: (opts.now?.() ?? new Date()).toISOString(), app: opts.app,
    recording: {
      id: session.id ?? dir.split("/").pop(), startedAt: session.startedAt ?? null, mode: session.mode ?? "unknown",
      recordedWith: session.app?.version ?? null,
      durationMs: wavs.length ? Math.round(Math.max(...wavs.map((f) => (f.bytes - 44) / 2)) / 16) : 0,
    },
    key: opts.key.fingerprint, files,
  };
  const text = JSON.stringify(payload);
  const seal: Seal = { payload: text, signature: opts.key.sign(text), publicKey: opts.key.publicKey, timestamps: [] };
  await addTimestamps(seal, opts.stamp);
  writeSeal(dir, seal);
  return seal;
}

async function addTimestamps(seal: Seal, stamp?: Stamp) {
  if (!stamp) return;
  const r = await stamp(createHash("sha256").update(seal.payload).digest());
  seal.timestamps.push(...r.tokens);
  if (r.failures.length) seal.timestampFailures = r.failures;
  else delete seal.timestampFailures;
}

/**
 * The recording's seal, made now (at export) when it has none. A seal without timestamps gets them now, when they
 * are on: a later timestamp still proves the recording existed by then.
 */
export async function ensureSeal(dir: string, opts: SealOptions): Promise<Seal> {
  const seal = readSeal(dir);
  if (!seal) return sealRecording(dir, { ...opts, when: "export" });
  if (opts.stamp && !seal.timestamps.length) {
    await addTimestamps(seal, opts.stamp);
    writeSeal(dir, seal);
  }
  return seal;
}

/** Whether the signature holds and every sealed file is unchanged; null without a seal. */
export async function checkSeal(dir: string, seal = readSeal(dir)): Promise<{ signature: boolean; intact: boolean; files: { name: string; ok: boolean; missing: boolean }[] } | null> {
  if (!seal) return null;
  const signature = verifySignature(seal.payload, seal.signature, seal.publicKey);
  let payload: SealPayload;
  try { payload = JSON.parse(seal.payload); } catch { return { signature: false, intact: false, files: [] }; }
  const files = [];
  for (const f of payload.files ?? []) {
    const p = join(dir, f.name);
    const missing = !existsSync(p);
    files.push({ name: f.name, ok: !missing && statSync(p).size === f.bytes && (await sha256File(p)) === f.sha256, missing });
  }
  return { signature, intact: signature && files.every((f) => f.ok), files };
}
