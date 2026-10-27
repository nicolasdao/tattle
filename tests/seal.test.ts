// The seal of a recording: this Mac's signing key, the fingerprints of the files that never change after a recording
// ends, a frozen copy of its transcript, and trusted timestamps. See docs/recordings.md § Proof of a recording.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  checkSeal, ensureSeal, keyFingerprint, readSeal, sealedTranscript, sealRecording, SigningKey, signingKeyPath, verifySignature,
  type SealPayload,
} from "../src/store/seal.ts";
import { cleanTmpDirs, recording, tmpDir } from "./fakes/index.ts";

afterEach(() => cleanTmpDirs());

const app = { name: "tattle", version: "1.1.0" };
const at = (iso: string) => () => new Date(iso);
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

function keyIn(dir = tmpDir("key-")) {
  return SigningKey.load(join(dir, "Tattle", "signing-key.json"));
}

/** A recording with two lines, one of them retried (the last wins), a filler, and a line with no text. */
function talk(root: string) {
  const dir = recording(root);
  const ev = (seq: number, type: string, data: unknown) => JSON.stringify({ seq, type, at: "x", data });
  writeFileSync(join(dir, "events.jsonl"), [
    ev(1, "session.started", { sessionId: "20260925-120000" }),
    ev(2, "utterance", { id: "u_2", stream: "remote", startMs: 4000, endMs: 6000, speakerId: "spk_2", speakerName: "Speaker 2", text: "first try", tags: [] }),
    ev(3, "utterance", { id: "u_1", stream: "host", startMs: 500, endMs: 2500, speakerId: "spk_1", speakerName: "Speaker 1", text: "Hello, Sam.", tags: [] }),
    ev(4, "utterance", { id: "u_2", stream: "remote", startMs: 4000, endMs: 6000, speakerId: "spk_2", speakerName: "Speaker 2", text: "Hi Nic, I agree to the terms.", tags: [] }),
    ev(5, "utterance", { id: "u_3", stream: "host", startMs: 7000, endMs: 7400, speakerId: "spk_1", speakerName: "Speaker 1", text: "Um.", filler: true, tags: [] }),
    ev(6, "utterance", { id: "u_4", stream: "host", startMs: 8000, endMs: 8400, speakerId: "spk_1", speakerName: "Speaker 1", text: "  ", tags: [] }),
    ev(7, "session.ended", { sessionId: "20260925-120000", reason: "stopped" }),
  ].join("\n") + "\n");
  writeFileSync(join(dir, "speakers.json"), JSON.stringify([{ id: "spk_1", displayName: "Nic" }, { id: "spk_2", displayName: "Sam" }]));
  writeFileSync(join(dir, "utterances.jsonl"), '{"id":"u_1"}\n{"id":"u_2"}\n');
  writeFileSync(join(dir, "transcriptions.jsonl"), '{"kind":"transcription","utterance_id":"u_1"}\n');
  return dir;
}

describe("the signing key", () => {
  test("created once, readable only by the user, in a private folder; the same key afterwards", () => {
    const base = tmpDir("key-");
    const path = join(base, "Tattle", "signing-key.json");
    const k = SigningKey.load(path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(base, "Tattle")).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ algorithm: "ECDSA P-256 SHA-256", createdAt: expect.any(String) });
    expect(SigningKey.load(path).publicKey).toBe(k.publicKey);
    expect(keyIn().publicKey).not.toBe(k.publicKey);
  });

  test("its fingerprint is the SHA-256 of its public key, in groups of four", () => {
    const k = keyIn();
    expect(k.fingerprint).toMatch(/^([0-9A-F]{4} ){15}[0-9A-F]{4}$/);
    expect(k.fingerprint.replace(/ /g, "").toLowerCase()).toBe(sha(Buffer.from(k.publicKey, "base64")));
    expect(keyFingerprint(k.publicKey)).toBe(k.fingerprint);
  });

  test("signs, and a signature checks only against the same bytes and key", () => {
    const k = keyIn();
    const sig = k.sign("the words");
    expect(verifySignature("the words", sig, k.publicKey)).toBe(true);
    expect(verifySignature("the wordz", sig, k.publicKey)).toBe(false);
    expect(verifySignature("the words", sig, keyIn().publicKey)).toBe(false);
    expect(verifySignature("the words", "not base64 at all", "nor this")).toBe(false);
  });

  test("an unreadable key file is an error, never silently replaced (a new key would be another signer)", () => {
    const base = tmpDir("key-");
    mkdirSync(join(base, "Tattle"));
    writeFileSync(join(base, "Tattle", "signing-key.json"), "{oops");
    expect(() => SigningKey.load(join(base, "Tattle", "signing-key.json"))).toThrow(/signing key .* cannot be read/);
  });

  test("where it lives: TATTLE_SIGNING_KEY, else next to the saved keys", () => {
    expect(signingKeyPath({ TATTLE_SIGNING_KEY: "/tmp/k.json" })).toBe("/tmp/k.json");
    expect(signingKeyPath({})).toMatch(/Application Support\/Tattle\/signing-key\.json$/);
  });
});

describe("sealRecording", () => {
  test("freezes the transcript, fingerprints the files that never change, and signs it", async () => {
    const dir = talk(tmpDir("lib-"));
    const key = keyIn();
    const seal = await sealRecording(dir, { key, app, when: "ended", now: at("2026-09-25T12:31:00Z") });

    expect(sealedTranscript(dir)).toEqual([
      { id: "u_1", stream: "host", startMs: 500, endMs: 2500, speakerId: "spk_1", speaker: "Nic", text: "Hello, Sam." },
      { id: "u_2", stream: "remote", startMs: 4000, endMs: 6000, speakerId: "spk_2", speaker: "Sam", text: "Hi Nic, I agree to the terms." },
      { id: "u_3", stream: "host", startMs: 7000, endMs: 7400, speakerId: "spk_1", speaker: "Nic", text: "Um.", filler: true },
    ]);
    const payload: SealPayload = JSON.parse(seal.payload);
    expect(payload).toEqual({
      format: "tattle-seal", version: 1, when: "ended", sealedAt: "2026-09-25T12:31:00.000Z", app,
      recording: { id: "20260925-120000", startedAt: "2026-09-25T12:00:00Z", mode: "live", recordedWith: "0.2.0", durationMs: 3000 },
      key: key.fingerprint,
      files: ["host.wav", "remote.wav", "transcript.jsonl", "utterances.jsonl", "transcriptions.jsonl"].map((name) => ({
        name, bytes: statSync(join(dir, name)).size, sha256: sha(readFileSync(join(dir, name))),
      })),
    });
    expect(seal.publicKey).toBe(key.publicKey);
    expect(verifySignature(seal.payload, seal.signature, key.publicKey)).toBe(true);
    expect(seal.timestamps).toEqual([]);
    expect(readSeal(dir)).toEqual(seal);
    expect(await checkSeal(dir)).toEqual({
      signature: true, intact: true, files: payload.files.map((f) => ({ name: f.name, ok: true, missing: false })),
    });
  });

  test("timestamps the payload's hash, and keeps why an authority failed", async () => {
    const dir = talk(tmpDir("lib-"));
    const seen: string[] = [];
    const seal = await sealRecording(dir, {
      key: keyIn(), app, when: "ended",
      stamp: async (h) => {
        seen.push(h.toString("hex"));
        return { tokens: [{ authority: "A", url: "http://a", genTime: "2026-09-25T12:31:01.000Z", token: "MAA=" }], failures: [{ authority: "B", url: "http://b", error: "HTTP 503" }] };
      },
    });
    expect(seen).toEqual([sha(seal.payload)]);
    expect(seal.timestamps).toEqual([{ authority: "A", url: "http://a", genTime: "2026-09-25T12:31:01.000Z", token: "MAA=" }]);
    expect(seal.timestampFailures).toEqual([{ authority: "B", url: "http://b", error: "HTTP 503" }]);
  });

  test("a recording with no audio and no events seals what it has", async () => {
    const dir = recording(tmpDir("lib-"));
    for (const f of ["host.wav", "remote.wav", "events.jsonl"]) rmSync(join(dir, f));
    const seal = await sealRecording(dir, { key: keyIn(), app, when: "export" });
    const payload: SealPayload = JSON.parse(seal.payload);
    expect(payload.files.map((f) => f.name)).toEqual(["transcript.jsonl"]);
    expect(payload.recording.durationMs).toBe(0);
    expect(sealedTranscript(dir)).toEqual([]);
  });
});

describe("checkSeal", () => {
  test("any changed byte, a missing file, or a changed signature shows; what is not sealed may change", async () => {
    const dir = talk(tmpDir("lib-"));
    await sealRecording(dir, { key: keyIn(), app, when: "ended" });
    // speakers renamed, a chat, a new name: none of it is sealed
    appendFileSync(join(dir, "events.jsonl"), '{"seq":8,"type":"speaker.updated","data":{"id":"spk_2","displayName":"Samantha"}}\n');
    writeFileSync(join(dir, "speakers.json"), "[]");
    writeFileSync(join(dir, "meta.json"), '{"name":"renamed"}');
    expect((await checkSeal(dir))!.intact).toBe(true);

    const wav = readFileSync(join(dir, "host.wav"));
    wav[1000] ^= 1;
    writeFileSync(join(dir, "host.wav"), wav);
    rmSync(join(dir, "transcriptions.jsonl"));
    const c = await checkSeal(dir);
    expect(c!.intact).toBe(false);
    expect(c!.files.filter((f) => !f.ok)).toEqual([{ name: "host.wav", ok: false, missing: false }, { name: "transcriptions.jsonl", ok: false, missing: true }]);

    const seal = readSeal(dir)!;
    writeFileSync(join(dir, "seal.json"), JSON.stringify({ ...seal, payload: seal.payload.replace("ended", "export") }));
    expect((await checkSeal(dir))!.signature).toBe(false);
  });

  test("no seal: null; a damaged seal.json reads as none", async () => {
    const dir = talk(tmpDir("lib-"));
    expect(await checkSeal(dir)).toBeNull();
    writeFileSync(join(dir, "seal.json"), "{");
    expect(readSeal(dir)).toBeNull();
  });
});

describe("ensureSeal", () => {
  test("seals a recording that has none, at export; keeps one that exists", async () => {
    const dir = talk(tmpDir("lib-"));
    const key = keyIn();
    const first = await ensureSeal(dir, { key, app, now: at("2026-10-01T09:00:00Z") });
    expect(JSON.parse(first.payload)).toMatchObject({ when: "export", sealedAt: "2026-10-01T09:00:00.000Z" });
    const again = await ensureSeal(dir, { key, app, now: at("2026-10-02T09:00:00Z") });
    expect(again).toEqual(first);
  });

  test("a seal made offline gets its timestamps later, for the same payload", async () => {
    const dir = talk(tmpDir("lib-"));
    const key = keyIn();
    const offline = await sealRecording(dir, { key, app, when: "ended", stamp: async () => ({ tokens: [], failures: [{ authority: "A", url: "u", error: "fetch failed" }] }) });
    const tokens = [{ authority: "A", url: "u", genTime: "2026-10-01T09:00:00.000Z", token: "MAA=" }];
    const later = await ensureSeal(dir, { key, app, stamp: async () => ({ tokens, failures: [] }) });
    expect(later.payload).toBe(offline.payload);
    expect(later.signature).toBe(offline.signature);
    expect(later.timestamps).toEqual(tokens);
    expect(later.timestampFailures).toBeUndefined();
    expect(readSeal(dir)).toEqual(later);
    // still none: what failed is kept, nothing else changes
    const dir2 = talk(tmpDir("lib-"));
    await sealRecording(dir2, { key, app, when: "ended" });
    const none = await ensureSeal(dir2, { key, app, stamp: async () => ({ tokens: [], failures: [{ authority: "A", url: "u", error: "x" }] }) });
    expect(none.timestamps).toEqual([]);
    expect(none.timestampFailures).toEqual([{ authority: "A", url: "u", error: "x" }]);
  });

  test("the frozen transcript is never rewritten once sealed", async () => {
    const dir = talk(tmpDir("lib-"));
    await sealRecording(dir, { key: keyIn(), app, when: "ended" });
    const before = readFileSync(join(dir, "transcript.jsonl"), "utf8");
    appendFileSync(join(dir, "events.jsonl"), JSON.stringify({ seq: 9, type: "utterance", data: { id: "u_9", startMs: 1, text: "added later" } }) + "\n");
    await ensureSeal(dir, { key: keyIn(), app });
    expect(readFileSync(join(dir, "transcript.jsonl"), "utf8")).toBe(before);
    expect(existsSync(join(dir, "seal.json"))).toBe(true);
  });
});

describe("what a seal makes of odd folders", () => {
  test("no session.json: the folder's name and unknowns; a torn line and an utterance without an id are skipped", async () => {
    const dir = talk(tmpDir("lib-"));
    rmSync(join(dir, "session.json"));
    appendFileSync(join(dir, "events.jsonl"), '{"seq":9,"type":"utterance","data":{"text":"no id"}}\n{"seq":10,"type":"utterance","da');
    const payload: SealPayload = JSON.parse((await sealRecording(dir, { key: keyIn(), app, when: "export" })).payload);
    expect(payload.recording).toEqual({ id: "20260925-120000", startedAt: null, mode: "unknown", recordedWith: null, durationMs: 3000 });
    expect(sealedTranscript(dir).map((l) => l.id)).toEqual(["u_1", "u_2", "u_3"]);
  });

  test("no frozen transcript reads as none; a payload that is not JSON, or lists no files, is not intact", async () => {
    expect(sealedTranscript(tmpDir("empty-"))).toEqual([]);
    const dir = talk(tmpDir("lib-"));
    const key = keyIn();
    const seal = await sealRecording(dir, { key, app, when: "ended" });
    expect(await checkSeal(dir, { ...seal, payload: "{not json" })).toEqual({ signature: false, intact: false, files: [] });
    const noFiles = JSON.stringify({ format: "tattle-seal" });
    expect(await checkSeal(dir, { ...seal, payload: noFiles, signature: key.sign(noFiles) })).toEqual({ signature: true, intact: true, files: [] });
  });
});
