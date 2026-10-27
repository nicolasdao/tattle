// The transcript export: a plain text record of who said what and when, signed by this Mac, carrying the recording's
// seal, with steps anyone can follow to check it with openssl. See docs/recordings.md § Transcript export.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { sealRecording, SigningKey, verifySignature } from "../src/store/seal.ts";
import { exportTranscript, SIGNATURE_LINE, transcriptFileName, VERIFY_DOCUMENT, VERIFY_SEAL } from "../src/store/transcript.ts";
import { cleanTmpDirs, recording, tmpDir } from "./fakes/index.ts";

afterEach(() => cleanTmpDirs());

const app = { name: "tattle", version: "1.1.0" };
const TZ = "Australia/Sydney";
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest();

/** A recording that starts at 23:59:58 in Sydney, so its lines cross midnight. */
function talk(root: string) {
  const dir = recording(root);
  writeFileSync(join(dir, "session.json"), JSON.stringify({
    id: "20260925-120000", app: { name: "tattle", version: "1.0.3" }, mode: "live", startedAt: "2026-09-25T13:59:58.000Z",
    streams: ["host", "remote"], transcription: { engine: "apple", locale: "en_AU" },
  }));
  const ev = (seq: number, type: string, data: unknown) => JSON.stringify({ seq, type, at: "x", data });
  writeFileSync(join(dir, "events.jsonl"), [
    ev(1, "utterance", { id: "u_1", stream: "host", startMs: 500, endMs: 1500, speakerId: "spk_1", speakerName: "Speaker 1", text: "Hello, Sam.", tags: [] }),
    ev(2, "utterance", { id: "u_2", stream: "remote", startMs: 3000, endMs: 3900, speakerId: "spk_2", speakerName: "Speaker 2", text: "Hi Nic,\nI agree\r\nto the terms.", tags: [] }),
    ev(3, "utterance", { id: "u_3", stream: "host", startMs: 3725_000, endMs: 3726_000, speakerId: "spk_1", speakerName: "Speaker 1", text: "Um.", filler: true, tags: [] }),
  ].join("\n") + "\n");
  writeFileSync(join(dir, "speakers.json"), JSON.stringify([{ id: "spk_1", displayName: "Nic" }, { id: "spk_2", displayName: "Speaker 2" }]));
  writeFileSync(join(dir, "utterances.jsonl"), "");
  writeFileSync(join(dir, "transcriptions.jsonl"), "");
  return dir;
}

const names: Record<string, string> = { spk_1: "Nic", spk_2: "Sam Lee" }; // Speaker 2 was named after the seal
const nameOf = (id: string) => names[id] ?? null;

async function made(o: { stampDoc?: boolean; stampSeal?: boolean; sealedBy?: SigningKey; when?: "ended" | "export" } = {}) {
  const dir = talk(tmpDir("lib-"));
  const key = SigningKey.load(join(tmpDir("key-"), "k.json"));
  const tokens = (prefix: string) => async (h: Buffer) => ({
    tokens: [{ authority: "DigiCert", url: "http://d", genTime: "2026-09-25T15:02:01.000Z", token: Buffer.from(`${prefix}:${h.toString("hex")}`).toString("base64") }],
    failures: [],
  });
  await sealRecording(dir, {
    key: o.sealedBy ?? key, app, when: o.when ?? "ended", now: () => new Date(o.when === "export" ? "2026-10-27T04:00:00Z" : "2026-09-25T15:02:00Z"),
    ...(o.stampSeal ? { stamp: tokens("seal") } : {}),
  });
  const out = tmpDir("out-");
  const r = await exportTranscript(dir, "20260925-120000", {
    key, app, name: "Contract call", durationMs: 3726_000, nameOf, timeZone: TZ, outDir: out, now: () => new Date("2026-10-27T04:05:00Z"),
    ...(o.stampDoc ? { stamp: tokens("doc") } : {}),
  });
  return { dir, key, r, text: readFileSync(r.path, "utf8") };
}

describe("the document", () => {
  test("a header, then every line with its elapsed and local time and its speaker's current name", async () => {
    const { r, text } = await made();
    expect(r.fileName).toBe("Contract call transcript.txt");
    expect(r.bytes).toBe(Buffer.byteLength(text));
    const head = text.slice(0, text.indexOf("TRANSCRIPT\n---"));
    expect(head).toContain("TATTLE CONVERSATION RECORD");
    expect(head).toContain("Recording        Contract call\n");
    expect(head).toContain("Recording ID     20260925-120000\n");
    expect(head).toContain("Started          Friday 25 September 2026, 23:59:58 (UTC+10:00, Australia/Sydney)\n                 2026-09-25T13:59:58.000Z\n");
    expect(head).toContain("Duration         1:02:06\n");
    expect(head).toContain("Kind             Live: this Mac's microphone and the sound it played (the call)\n");
    expect(head).toContain("Speakers         Nic, Sam Lee (named \"Speaker 2\" when sealed)\n");
    expect(head).toContain("Transcribed by   Apple Speech, on the Mac that recorded it (en_AU)\n");
    expect(head).toContain("Recorded with    Tattle 1.0.3\n");
    expect(head).toContain("Exported         Tuesday 27 October 2026, 15:05:00 (UTC+11:00, Australia/Sydney), with Tattle 1.1.0\n");
    expect(head).toMatch(/speech recognition and can contain errors/);

    const body = text.slice(text.indexOf("TRANSCRIPT\n---"), text.indexOf("INTEGRITY RECORD"));
    expect(body).toContain([
      "[0:00:00 | 23:59:58] Nic: Hello, Sam.",
      "[0:00:03 | 00:00:01] (Saturday 26 September 2026)",
      "[0:00:03 | 00:00:01] Sam Lee: Hi Nic, I agree to the terms.",
      "[1:02:05 | 01:02:03] Nic: Um.",
      "",
      "END OF TRANSCRIPT: 3 lines",
    ].join("\n"));
  });

  test("an empty recording says so; no name falls back to the id; times in UTC", async () => {
    const dir = recording(tmpDir("lib-"));
    writeFileSync(join(dir, "events.jsonl"), "");
    const key = SigningKey.load(join(tmpDir("key-"), "k.json"));
    const r = await exportTranscript(dir, "20260925-120000", { key, app, name: null, durationMs: 3000, nameOf, timeZone: "UTC", outDir: tmpDir("out-") });
    const text = readFileSync(r.path, "utf8");
    expect(r.fileName).toBe("Recording 20260925-120000 transcript.txt");
    expect(text).toContain("Recording        Recording 20260925-120000\n");
    expect(text).toContain("Started          Friday 25 September 2026, 12:00:00 (UTC+00:00, UTC)\n");
    expect(text).toContain("Transcribed by   OpenAI\n"); // recordings from before the engine was recorded
    expect(text).toContain("(No speech was transcribed.)\n\nEND OF TRANSCRIPT: 0 lines");
    expect(existsSync(join(dir, "seal.json"))).toBe(true); // sealed now, at export
  });

  test("the integrity record: the seal, the files' fingerprints, the keys, what it proves and what it does not", async () => {
    const { text, key, dir } = await made();
    const rec = text.slice(text.indexOf("INTEGRITY RECORD"));
    expect(rec).toContain("Sealed           Saturday 26 September 2026, 01:02:00 (UTC+10:00, Australia/Sydney), when the recording ended\n");
    expect(rec).toContain(`Signed by        Tattle key ${key.fingerprint} (this Mac)\n`);
    expect(rec).toContain("Timestamped by   None: trusted timestamps were off.\n");
    const wav = readFileSync(join(dir, "host.wav"));
    expect(rec).toContain(`host.wav, ${wav.length.toLocaleString("en-US")} bytes\n                   SHA-256 ${sha(wav).toString("hex")}\n`);
    expect(rec).toContain("transcript.jsonl");
    expect(rec).toMatch(/What this record proves/);
    expect(rec).toMatch(/What it does not prove/);
    expect(rec).toMatch(/consent/);
    expect(text.endsWith("-----END TATTLE SIGNATURE-----\n")).toBe(true);
  });

  test("a recording sealed at its first export says how long after it was recorded; a seal by another Mac says so", async () => {
    const other = SigningKey.load(join(tmpDir("key-"), "other.json"));
    const { text } = await made({ when: "export", sealedBy: other });
    expect(text).toContain("Sealed           Tuesday 27 October 2026, 15:00:00 (UTC+11:00, Australia/Sydney), at its first export, 32 days after it was recorded\n");
    expect(text).toContain(`Signed by        Tattle key ${other.fingerprint} (another Mac: the one that sealed it)\n`);
  });

  test("timestamps: the seal's and the document's, each over its own hash, as lines a verifier can extract", async () => {
    const { text } = await made({ stampSeal: true, stampDoc: true });
    expect(text).toContain("Timestamped by   DigiCert: 2026-09-25T15:02:01.000Z\n");
    const signed = text.slice(0, text.indexOf(SIGNATURE_LINE));
    const sealPayload = text.match(/^Seal-Payload: (.*)$/m)![1];
    const tok = (name: string) => Buffer.from(text.match(new RegExp(`^${name}: (.*)$`, "m"))![1], "base64").toString();
    expect(tok("Seal-Timestamp-DigiCert")).toBe(`seal:${sha(sealPayload).toString("hex")}`);
    expect(tok("Timestamp-DigiCert")).toBe(`doc:${sha(signed).toString("hex")}`);
  });

  test("the signature covers every byte before it", async () => {
    const { text, key } = await made();
    const signed = text.slice(0, text.indexOf(SIGNATURE_LINE));
    const sig = text.match(/^Signature: (.*)$/m)![1];
    expect(text.match(/^Public-Key: (.*)$/m)![1]).toBe(key.publicKey);
    expect(verifySignature(signed, sig, key.publicKey)).toBe(true);
    expect(verifySignature(signed.replace("I agree", "I disagree"), sig, key.publicKey)).toBe(false);
  });

  test("a bare recording: no start time, kind, or version; OpenAI with its model; Apple without a locale", async () => {
    const dir = talk(tmpDir("lib-"));
    writeFileSync(join(dir, "session.json"), JSON.stringify({ id: "20260925-120000", transcription: { engine: "openai", model: "gpt-transcribe" } }));
    const key = SigningKey.load(join(tmpDir("key-"), "k.json"));
    const opts = { key, app, name: "Bare", durationMs: 0, nameOf, timeZone: TZ, outDir: tmpDir("out-") };
    const text = readFileSync((await exportTranscript(dir, "20260925-120000", opts)).path, "utf8");
    expect(text).toContain("Started          Unknown\n");
    expect(text).toContain("Kind             Unknown\n");
    expect(text).toContain("Transcribed by   OpenAI (gpt-transcribe)\n");
    expect(text).toContain("Recorded with    Tattle, before it recorded its version\n");
    expect(text).toContain("[0:00:00] Nic: Hello, Sam.\n[0:00:03] Sam Lee: Hi Nic"); // no local time, no day lines
    expect(text).toMatch(/, at its first export\n/);
    writeFileSync(join(dir, "session.json"), JSON.stringify({ transcription: { engine: "apple" } }));
    expect(readFileSync((await exportTranscript(dir, "20260925-120000", opts)).path, "utf8")).toContain("Transcribed by   Apple Speech, on the Mac that recorded it\n");
  });

  test("a one-day-old recording, and authorities that all failed, for the seal and for the document", async () => {
    const dir = talk(tmpDir("lib-"));
    const key = SigningKey.load(join(tmpDir("key-"), "k.json"));
    const failing = async () => ({ tokens: [], failures: [{ authority: "DigiCert", url: "u", error: "fetch failed" }, { authority: "FreeTSA", url: "u", error: "HTTP 503" }] });
    const text = readFileSync((await exportTranscript(dir, "20260925-120000", {
      key, app, name: "x", durationMs: 0, nameOf, timeZone: TZ, outDir: tmpDir("out-"), stamp: failing, now: () => new Date("2026-09-26T14:00:00Z"),
    })).path, "utf8");
    expect(text).toContain("at its first export, 1 day after it was recorded\n");
    expect(text).toContain("Timestamped by   None: no timestamp authority could be reached (DigiCert: fetch failed; FreeTSA: HTTP 503).\n");
    expect(text).toContain("\nTimestamps: None: no timestamp authority could be reached (DigiCert: fetch failed; FreeTSA: HTTP 503).\n-----END TATTLE SIGNATURE-----\n");
  });

  test("file names: unsafe characters become spaces", () => {
    expect(transcriptFileName("Call: a/b", "x")).toBe("Call a b transcript.txt");
  });
});

// The document's own verification steps, run as written, with every openssl on this Mac: macOS's LibreSSL and OpenSSL 3.
const openssls = ["/usr/bin/openssl", (() => { try { return execFileSync("which", ["openssl"]).toString().trim(); } catch { return ""; } })()]
  .filter((p, i, a) => p && existsSync(p) && a.indexOf(p) === i);

describe.each(openssls)("verifying with %s", (openssl) => {
  const run = (cwd: string, steps: string[]) =>
    execFileSync("/bin/sh", ["-c", steps.join("\n")], { cwd, env: { PATH: `${join(openssl, "..")}:/usr/bin:/bin` } }).toString();

  test("the document's and the seal's steps print Verified OK; a changed word fails", async () => {
    const { r, text } = await made({ stampDoc: true, stampSeal: true });
    for (const step of [...VERIFY_DOCUMENT, ...VERIFY_SEAL]) expect(text).toContain(`     ${step}\n`);
    const cwd = join(r.path, "..");
    writeFileSync(join(cwd, "transcript.txt"), text);
    expect(run(cwd, VERIFY_DOCUMENT)).toContain("Verified OK");
    expect(run(cwd, VERIFY_SEAL)).toContain("Verified OK");
    writeFileSync(join(cwd, "transcript.txt"), text.replace("I agree", "I disagree"));
    // openssl exits with 1 and never says Verified OK (OpenSSL 3: "Verification failure"; LibreSSL: "Error Verifying Data")
    let failed: any = null;
    try { run(cwd, VERIFY_DOCUMENT); } catch (e) { failed = e; }
    expect(failed?.status).toBe(1);
    expect(`${failed.stdout}${failed.stderr}`).toMatch(/Verification failure|Error Verifying Data/);
    expect(`${failed.stdout}`).not.toContain("Verified OK");
    expect(run(cwd, VERIFY_SEAL)).toContain("Verified OK"); // the seal does not cover the document's words
  });
});
