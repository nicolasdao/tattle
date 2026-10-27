// The transcript export: a plain UTF-8 text record of a recording (who said what, and when, in elapsed and local
// time), carrying the recording's seal and signed by this Mac, with steps anyone can follow to check it with openssl,
// without Tattle. See docs/recordings.md § Transcript export.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSeal, sealedTranscript, type Seal, type SealPayload, type SigningKey, type Stamp } from "./seal.ts";
import type { TimestampFailure, TimestampToken } from "./timestamp.ts";

export const SIGNATURE_LINE = "-----BEGIN TATTLE SIGNATURE-----\n";

/** Checks this document's signature (it covers every byte before the signature block). */
export const VERIFY_DOCUMENT = [
  "sed '/^-----BEGIN TATTLE SIGNATURE-----$/,$d' transcript.txt > signed.txt",
  "{ echo '-----BEGIN PUBLIC KEY-----'; sed -n 's/^Public-Key: //p' transcript.txt | fold -w 64; echo '-----END PUBLIC KEY-----'; } > key.pem",
  "sed -n 's/^Signature: //p' transcript.txt | openssl base64 -d -A > signature.der",
  "openssl dgst -sha256 -verify key.pem -signature signature.der signed.txt",
];

/** Checks the recording's seal, as it was signed when the recording was sealed. */
export const VERIFY_SEAL = [
  "sed -n 's/^Seal-Payload: //p' transcript.txt | tr -d '\\n' > seal.json",
  "{ echo '-----BEGIN PUBLIC KEY-----'; sed -n 's/^Seal-Public-Key: //p' transcript.txt | fold -w 64; echo '-----END PUBLIC KEY-----'; } > seal-key.pem",
  "sed -n 's/^Seal-Signature: //p' transcript.txt | openssl base64 -d -A > seal-signature.der",
  "openssl dgst -sha256 -verify seal-key.pem -signature seal-signature.der seal.json",
];

const LABEL = 17;
const field = (label: string, ...lines: string[]) =>
  lines.map((l, i) => (i === 0 ? label.padEnd(LABEL) : " ".repeat(LABEL)) + l).join("\n");
// line breaks of any kind (\u2028 and \u2029 too) become spaces: one spoken line is one line of text
const oneLine = (s: string) => s.replace(/\s*[\r\n\v\f\x85\u2028\u2029]+\s*/g, " ").trim();

/** A file name for the transcript: the recording's name (or id), safe on every system. */
export function transcriptFileName(name: string | null, id: string): string {
  const base = (name ?? "").replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || `Recording ${id}`;
  return `${base} transcript.txt`;
}

/** 1:02:06 */
function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** A moment in a time zone: "Friday 25 September 2026", "23:59:58", "UTC+10:00". */
function local(d: Date, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  const offset = p.timeZoneName === "GMT" ? "+00:00" : String(p.timeZoneName).replace("GMT", "");
  return { date: `${p.weekday} ${p.day} ${p.month} ${p.year}`, time: `${p.hour}:${p.minute}:${p.second}`, offset: `UTC${offset}` };
}

const when = (d: Date, timeZone: string) => {
  const l = local(d, timeZone);
  return `${l.date}, ${l.time} (${l.offset}, ${timeZone})`;
};

/** A line key for an authority: Seal-Timestamp-DigiCert. */
const tokenKey = (authority: string) => authority.replace(/[^A-Za-z0-9]+/g, "");

/** What timestamps there are; with none, whether they were off or every authority failed. */
function stamps(tokens: TimestampToken[], failures: TimestampFailure[] | undefined): string[] {
  if (tokens.length) return tokens.map((t) => `${t.authority}: ${t.genTime}`);
  if (!failures?.length) return ["None: trusted timestamps were off."];
  return [`None: no timestamp authority could be reached (${failures.map((f) => `${f.authority}: ${f.error}`).join("; ")}).`];
}

function transcribedBy(t: any): string {
  if (t?.engine === "apple") return `Apple Speech, on the Mac that recorded it${t.locale ? ` (${t.locale})` : ""}`;
  return `OpenAI${t?.model ? ` (${t.model})` : ""}`;
}

const KINDS: Record<string, string> = {
  live: "Live: this Mac's microphone and the sound it played (the call)",
  replay: "Replay: the audio of an earlier recording, transcribed again",
};

export interface TranscriptExportOptions {
  key: SigningKey;
  app: { name: string; version: string };
  name: string | null;
  durationMs: number;
  /** A speaker's current name (renames and merges since the seal), or null to keep the name sealed with the line. */
  nameOf: (speakerId: string) => string | null;
  /** Trusted timestamps, for the seal (when it has none yet) and for this document. */
  stamp?: Stamp;
  now?: () => Date;
  timeZone?: string;
  outDir?: string;
}

/** Writes the transcript document to a temporary file; returns its path. Seals the recording first if it has no seal. */
export async function exportTranscript(dir: string, id: string, opts: TranscriptExportOptions): Promise<{ path: string; fileName: string; bytes: number }> {
  const seal = await ensureSeal(dir, { key: opts.key, app: opts.app, stamp: opts.stamp, now: opts.now });
  const payload: SealPayload = JSON.parse(seal.payload);
  const session = (() => { try { return JSON.parse(readFileSync(join(dir, "session.json"), "utf8")); } catch { return {}; } })();
  const tz = opts.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = opts.now?.() ?? new Date();
  const startedAt = session.startedAt ? new Date(session.startedAt) : null;
  const title = opts.name?.trim() || `Recording ${id}`;

  const lines = sealedTranscript(dir).map((l) => ({ ...l, current: opts.nameOf(l.speakerId) ?? l.speaker }));
  const speakers = new Map<string, { current: string; sealed: string }>();
  for (const l of lines) if (!speakers.has(l.speakerId)) speakers.set(l.speakerId, { current: l.current, sealed: l.speaker });
  const speakerList = [...new Set([...speakers.values()].map((s) => (s.current === s.sealed ? s.current : `${s.current} (named "${s.sealed}" when sealed)`)))];

  const out: string[] = [
    "TATTLE CONVERSATION RECORD",
    "==========================",
    "",
    field("Recording", oneLine(title)),
    field("Recording ID", id),
    field("Started", ...(startedAt ? [when(startedAt, tz), startedAt.toISOString()] : ["Unknown"])),
    field("Duration", elapsed(opts.durationMs)),
    field("Kind", KINDS[session.mode] ?? "Unknown"),
    field("Speakers", speakerList.length ? oneLine(speakerList.join(", ")) : "None"),
    field("Transcribed by", transcribedBy(session.transcription)),
    field("Recorded with", session.app?.version ? `Tattle ${session.app.version}` : "Tattle, before it recorded its version"),
    field("Exported", `${when(now, tz)}, with Tattle ${opts.app.version}`),
    "",
    "Each line gives the time since the recording started, then the local time it was",
    "said, then who said it. Speaker names were given by the person who recorded the",
    "conversation. The words come from automatic speech recognition and can contain errors:",
    "the audio recording is the primary record, and this transcript is derived from it.",
    "Keep this file as it is: re-saving it in an editor can change invisible characters",
    "and break its signature.",
    "",
    "TRANSCRIPT",
    "----------",
    "",
  ];
  let day = startedAt ? local(startedAt, tz).date : null;
  for (const l of lines) {
    const at = startedAt ? local(new Date(startedAt.getTime() + l.startMs), tz) : null;
    const stamp = `[${elapsed(l.startMs)}${at ? ` | ${at.time}` : ""}]`;
    if (at && at.date !== day) {
      out.push(`${stamp} (${at.date})`);
      day = at.date;
    }
    out.push(`${stamp} ${oneLine(l.current)}: ${oneLine(l.text)}`);
  }
  if (!lines.length) out.push("(No speech was transcribed.)");
  out.push("", `END OF TRANSCRIPT: ${lines.length} line${lines.length === 1 ? "" : "s"}`, "");

  const sealedAt = new Date(payload.sealedAt);
  const days = startedAt ? Math.round((sealedAt.getTime() - startedAt.getTime()) / 86_400_000) : null;
  const sealedHow = payload.when === "ended"
    ? "when the recording ended"
    : `at its first export${days !== null ? `, ${days} day${days === 1 ? "" : "s"} after it was recorded` : ""}`;
  const byThisMac = seal.publicKey === opts.key.publicKey;
  out.push(
    "INTEGRITY RECORD",
    "----------------",
    "",
    "The recording",
    field("Sealed", `${when(sealedAt, tz)}, ${sealedHow}`),
    field("Signed by", `Tattle key ${payload.key} (${byThisMac ? "this Mac" : "another Mac: the one that sealed it"})`),
    field("Timestamped by", ...stamps(seal.timestamps, seal.timestampFailures)),
    field("Sealed files", ...payload.files.flatMap((f) => [`${f.name}, ${f.bytes.toLocaleString("en-US")} bytes`, `  SHA-256 ${f.sha256}`])),
    "",
  );
  // the document's own timestamps are only known once the signed part is final, so they are listed in the signature
  // block, after it; this section says where to find them
  out.push(
    "This document",
    field("Signed by", `Tattle key ${opts.key.fingerprint} (this Mac)`),
    field("Timestamped by", opts.stamp ? "See the Timestamp lines in the signature block at the end." : "None: trusted timestamps were off."),
    "",
    "What this record proves",
    "  - The sealed files are, byte for byte, what Tattle had when it sealed them: anyone",
    "    holding them can recompute the SHA-256 fingerprints above. transcript.jsonl holds",
    "    every line above, as it was when sealed.",
    "  - With a timestamp, that they existed no later than the time an independent",
    "    authority certified.",
    "  - That this document has not changed since it was signed (and, with a timestamp,",
    "    that it existed then).",
    "",
    "What it does not prove",
    "  - Who the speakers are: their names were typed by the person who recorded.",
    "  - That speech recognition heard every word right: check it against the audio.",
    "  - That everyone recorded knew and consented: record that separately.",
    "  - That the conversation was not staged before it was recorded.",
    "  - Who holds the signing key: it identifies a Tattle installation, not a person.",
    "    Confirm its fingerprint with the person who recorded.",
    "",
    "HOW TO VERIFY",
    "-------------",
    "",
    "Save this file as transcript.txt, then run these commands in its folder (macOS or",
    "Linux). The signature checks work with any openssl; the timestamp checks need",
    "OpenSSL 3 (on a Mac: brew install openssl).",
    "",
    "1. This document's signature. The last command prints \"Verified OK\":",
    ...VERIFY_DOCUMENT.map((c) => `     ${c}`),
    "",
    "2. The recording's seal. The last command prints \"Verified OK\":",
    ...VERIFY_SEAL.map((c) => `     ${c}`),
    "",
    "3. The recording's files. Export the recording from Tattle with its original audio",
    "   (Export, Original audio), unzip the .tattle file, and compare the output of",
    "     shasum -a 256 audio/host.wav audio/remote.wav data/transcript.jsonl data/utterances.jsonl data/transcriptions.jsonl",
    "   with the fingerprints in seal.json (step 2) and above.",
    "",
    "4. A timestamp, here DigiCert's (the same for the others). For the seal:",
    "     sed -n 's/^Seal-Timestamp-DigiCert: //p' transcript.txt | openssl base64 -d -A > seal-digicert.tst",
    "     openssl ts -verify -data seal.json -in seal-digicert.tst -token_in -CAfile roots.pem",
    "   For this document, the same with Timestamp-DigiCert and -data signed.txt (step 1).",
    "   It prints \"Verification: OK\"; openssl ts -reply -in seal-digicert.tst -token_in -text",
    "   shows the time. roots.pem holds the authorities' root certificates: on a Mac,",
    "     security find-certificate -a -p /System/Library/Keychains/SystemRootCertificates.keychain > roots.pem",
    "   on Linux, /etc/ssl/certs/ca-certificates.crt; FreeTSA's own root is at",
    "   https://freetsa.org/files/cacert.pem.",
    "",
    "SEAL DATA",
    "---------",
    "",
    `Seal-Payload: ${seal.payload}`,
    `Seal-Signature: ${seal.signature}`,
    `Seal-Public-Key: ${seal.publicKey}`,
    ...seal.timestamps.map((t) => `Seal-Timestamp-${tokenKey(t.authority)}: ${t.token}`),
    "",
  );
  const signed = out.join("\n") + "\n";
  const docTokens = opts.stamp ? await opts.stamp(createHash("sha256").update(signed).digest()) : { tokens: [], failures: [] };
  const block = [
    SIGNATURE_LINE.trimEnd(),
    "Algorithm: ECDSA P-256 SHA-256",
    `Public-Key: ${opts.key.publicKey}`,
    `Signature: ${opts.key.sign(signed)}`,
    ...docTokens.tokens.map((t) => `Timestamp-${tokenKey(t.authority)}: ${t.token}`),
    ...(docTokens.failures.length && !docTokens.tokens.length ? [`Timestamps: ${stamps([], docTokens.failures)[0]}`] : []),
    "-----END TATTLE SIGNATURE-----",
  ].join("\n") + "\n";
  const text = signed + block;
  const path = join(opts.outDir ?? tmpdir(), `pa-${id}-${Date.now()}.txt`);
  writeFileSync(path, text);
  return { path, fileName: transcriptFileName(opts.name, id), bytes: Buffer.byteLength(text) };
}

export type { Seal };
