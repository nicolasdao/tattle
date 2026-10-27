---
description: Where every session is stored, what each file holds, and how the recordings library lists, names, searches, reopens, plays back, replays, exports, imports, and deletes past sessions — plus the seal that proves a recording unchanged (signature and trusted timestamps) and the signed transcript export.
tags: [sessions, storage, library, replay, playback, export, import, api, seal, proof, timestamps, transcript]
source:
  - src/store/sessionStore.ts
  - src/paths.ts
  - src/store/library.ts
  - src/store/events.ts
  - src/server/main.ts
  - src/server/audio.ts
  - src/store/transfer.ts
  - src/store/zip.ts
  - web/src/transfer.ts
  - src/store/seal.ts
  - src/store/timestamp.ts
  - src/store/transcript.ts
---

# Recordings

Every session — live or replay — is kept as one folder of plain files. There is no database. The recordings library reads those folders to list, search, name, and reopen them.

## Session folders

`src/store/sessionStore.ts` creates `<YYYYMMDD-HHMMSS>/` in the recordings folder at session start. The recordings folder (`sessions` in `src/paths.ts`) is the project's `sessions/` for `npm run serve` and the CLI tools, and `~/Library/Application Support/Tattle/sessions` in the Mac app (see [The Mac app](desktop.md#where-the-app-keeps-its-files--srcpathsts)); `sessions/` below means that folder. The two are separate libraries: to see recordings made in development in the app, move their folders across, or export and import them. `npm run smoke` and `npm run preflight` write only their call logs, to `smoke-…` and `preflight-…` folders; those have no `session.json`, so the library never lists them. Every JSONL file is append-only and flushed on every write, so a crash loses at most the last line.

| File | Holds |
| --- | --- |
| `host.wav`, `remote.wav` | The streams as received, 16 kHz mono PCM16 — enough to replay the session exactly. Their headers get the final sizes as soon as the input ends, before the rest of the session's ending (see [Architecture](architecture.md#the-session-pipeline--srcpipelinesessionts)), so the audio is complete even if the app quits while fact-checks drain |
| `session.json` | Mode, start time, `app` (the name and version that recorded it; absent before 0.3.0), streams, config snapshot, `features` (fact-check and labels on or off; see [Architecture](architecture.md#features-transcript-only-sessions)), `transcription` (`{ engine: "apple", locale }` or `{ engine: "openai", model }`: the engine it ran with; absent before 29 September 2026, which means OpenAI; see [Transcription](transcription.md)), `labelSet` (a full copy of the session's label set, so editing the set later changes nothing here; `null` with labels off), `stories`, `labelSetVersion`, System 1 set. Recordings made before label sets (29 September 2026) hold the old single set (a `questions` map) and their stories in `config.timeline`: the library converts that set, their stored `stats` events, and their `section.updated` events to the new format when they are opened (`src/labels/legacy.ts`), so the page only sees one format |
| `events.jsonl` | Every event the page received (except transient live text) |
| `utterances.jsonl` | VAD utterances with times, speaker id, and the `loud` tag (`overlap` is computed later and appears only in Jev states) |
| `transcriptions.jsonl` | One row per final (`transcription`) and live (`live_transcription`) transcription call, with cost. Final rows carry `engine`: `apple` (always `cost_usd: 0`; Apple's live text logs no rows) or `openai` (rows from before 29 September 2026 have none: OpenAI) |
| `jev_calls.jsonl`, `s2_calls.jsonl` | One row per Jev and GPT-6 Luna call, with state, answers, and cost |
| `segments.jsonl`, `labels.jsonl`, `claims.jsonl`, `verdicts.jsonl`, `s1_versions.jsonl`, `audits.jsonl` | Pipeline results |
| `speakers.json` | Final speaker list, written at session end |
| `meta.json` | Library metadata: `name`, `notes` (only if set) |
| `imported.json` | Only for an imported recording: when, from which file, and the file's manifest (see [Export and import](#export-and-import)) |
| `seal.json`, `transcript.jsonl` | The recording's seal and its frozen transcript, written when it ends (or at its first export, for a recording from before seals): see [Proof of a recording](#proof-of-a-recording) |
| `chats.jsonl` | The chat window's chats, messages, and calls with cost — written live and after the recording ended, since a recording can be chatted about (see [Chat](chat.md)) |

Keys are redacted from every file and event.

## The library — `src/store/library.ts`

`SessionLibrary` scans `sessions/` for folders with a `session.json`. Folders prefixed `smoke-`, `preflight-`, or `dev-` are hidden unless `includeTools` (`?all=1`) is set. Each recording is summarised from its files: name, notes, mode, start time, duration (from WAV size), whether `session.ended` was recorded, utterance count, speakers (from `speakers.json`, else from speaker events), segments, claims, and total cost (also by bucket: transcription, Jev, System 2, chat). Summaries are cached per folder and recomputed when `events.jsonl`, `meta.json`, `speakers.json`, or `chats.jsonl` changes.

- **Search** (`list({ q })`) is case-insensitive. A recording matches when every word appears in its metadata (name, notes, id, speaker names), or every word appears in one single utterance; a word in the name plus another in a transcript line does not match. up to 5 matching lines are returned per recording as `{ utteranceId, startMs, speaker, snippet }`.
- **Names and notes** are written to `meta.json`, never to the append-only files. An empty string clears the field. Names are limited to 120 characters and notes to 4,000.
- **Ids** must match `^[A-Za-z0-9][A-Za-z0-9_-]*$`, so a request cannot reach outside `sessions/`.

## Open vs Replay

| | Open | Replay |
| --- | --- | --- |
| What happens | The recorded `events.jsonl` is loaded into the event bus (`EventBus.load`) and the page rebuilds the session from it | The session's WAVs run through the whole pipeline again as a new session |
| API calls | None — free | All of them: transcription, Jev, System 2, and live text at speed 1 — about the original session's cost again (more than a `--speed max` replay, which skips live text) |
| Editable | Speakers (rename and merge are saved into the recording, below) and chats about it ([Chat](chat.md)); every other command returns 409 | Yes, like any session |
| Result | Exactly what was seen at the time | A new session folder; answers can differ (Jev and GPT-6 Luna are not deterministic) |

Renaming or merging a speaker on an open recording appends the `speaker.updated` or `speaker.merged` event to its `events.jsonl` (append-only, like every other event) and applies it to `speakers.json`, so the page updates at once, the library lists the new names, and reopening replays the edit. Search snippets show each line's speaker by their current name.

While a recording is open, `GET /api/state` returns an archived snapshot (`session.status: "archived"`), and the page shows Archive in the header's ON AIR block, with no stream meters. Starting a live session or a replay leaves the archived view. A session that ends (Stop, or the end of a replay's input) becomes one too: the engine switches to serving it as an opened recording, and the page shows it as Archive.

**Playback.** An open recording can be listened to: `GET /api/sessions/:id/audio` mixes `host.wav` and `remote.wav` on the fly into one 16 kHz mono WAV (the shorter stream padded). Each stream is raised to a common speech level first: its loud speech (the 95th percentile of 100 ms blocks, sampled every 2 s, cached per file) is brought to −12 dBFS (on laptop speakers, −14 was slightly too quiet and −10 sounded saturated), with at most +20 dB of gain, because recorded speech sat around −24 to −28 dBFS, well under a typical podcast; this also balances the host's mic against the call. The sum then goes through a soft limiter (linear up to 0.85 of full scale, bent smoothly towards it above, so only the loudest peaks are touched) instead of clipping. The page adds a volume boost on top (100–300 %, a Web Audio gain node), with HTTP Range support so the page can seek, and without loading the files (`src/server/audio.ts`). Both files share the session clock (sample index ÷ 16 = session ms), so the audio's time is the timeline's time. The page plays it in an `<audio>` element at 1×–4× with `preservesPitch`, so sped-up voices keep their pitch (see [Architecture](architecture.md)). Playback exists only for recordings, never on air.

## Export and import

A recording can be shared as **one file**, `<name>.tattle` (files named `.conversation-recording` or `.podcast-recording`, exported under the app's earlier names, still import), typically over WhatsApp or email, with someone who has Tattle too (`src/store/transfer.ts`, `src/store/zip.ts`).

**The format** is a ZIP with its own extension:
- A ZIP is the standard way to bundle files, and Node's zlib is enough to write and read it (a minimal writer and reader, no dependency). The system's own `unzip` opens it too.
- The custom extension exists because Safari unzips a downloaded `.zip` into a folder, and because WhatsApp and email then send the file as a plain document.

Inside:

| Entry | Holds |
| --- | --- |
| `manifest.json` (first) | `format: "tattle-recording"` (`"conversation-assistant-recording"` and `"podcast-assistant-recording"`, from the app's earlier names, still import), `formatVersion` (1), `app` (name and version that **exported** it), `exportedAt`; `recording` (`id`, `name`, `startedAt`, `durationMs`, `mode`, `recordedWith`: the version that **recorded** it, from `session.json`, or null before 0.3.0); `audio` (`choice`, `format`, `bitrate`, and each stream's sample count); `chats`; `files` |
| `data/*` | The session's files, deflated: `session.json`, `meta.json`, `speakers.json`, every JSONL file, `seal.json` and `transcript.jsonl` (byte for byte, so the importer can check them); `chats.jsonl` only when chosen. `events.jsonl` leaves out the folder the recording was made in (`dir`: in the Mac app it is under the home folder, which names the user); opening the recording fills in the importer's own |
| `audio/host.m4a`, `audio/remote.m4a` | Compressed audio (the default), stored |
| `audio/host.wav`, `audio/remote.wav` | Or the original WAVs, stored |

**Audio choices** (the Export window shows each one's estimated size, and where a file that size can go):

| Choice | Two-hour show (measured) | Notes |
| --- | --- | --- |
| Compressed | 56.7 MB, exported in 11 s | AAC at 32 kbps per stream through macOS's own `afconvert`. Decoded back, each stream has exactly its original sample count and no time shift (checked by cross-correlation), so transcript times still match the audio. |
| Original | ≈ 452 MB | The WAVs byte for byte |
| No audio | ≈ 3 MB | Fits email; the importer gets no playback or replay |
| Transcript only | ≈ 40 KB an hour | Not a `.tattle` file: the signed text record (see [Transcript export](#transcript-export)) |

With **Original** audio the seal still holds after import, byte for byte; with **Compressed** audio the two WAVs no longer match their fingerprints (AAC is lossy), though everything else does. To hand someone checkable proof, export the original audio.

- **Chats are left out by default:** they are the exporter's own questions. The Export window has a switch to include them.
- Email usually takes files up to about 25 MB and WhatsApp documents up to 2 GB; the Export window says which applies.

**Export**, from the header (a recording on screen) or a row of the Recordings window:
1. `POST /api/sessions/:id/export { audio: "compressed" | "original" | "none", chats }` writes the file to the system's temporary folder and returns `{ token, fileName, bytes }`; `{ format: "transcript", timestamps }` writes the [transcript](#transcript-export) instead. A recording with no seal yet is sealed first (a seal that fails is logged and the `.tattle` export goes ahead). Errors show in the window.
2. The page then downloads `GET /api/exports/:token` (`Content-Disposition: attachment`), usually to Downloads; the Mac app always saves it there, as `<name> (2).tattle` and so on when the name is taken. The file is deleted once sent, or after 15 minutes.
3. A session still on air cannot be exported (409).

**Import**, from the header (anything but a session on air), the Recordings window, or by dropping the file anywhere on the page:
1. `POST /api/sessions/import` takes the raw file (up to 4 GB) with its name in `X-File-Name` (refused with 409 while a session is on air: unpacking competes with live capture), and the page shows upload progress when the browser reports it. The Mac app's window reports none (the upload is in-process and instant), so there the bar moves back and forth until the recording is unpacked.
2. The engine checks the manifest. A file from a newer `formatVersion` is refused with the version that made it ("update the app to import it").
3. It writes only the files it knows, to a hidden `sessions/.import-…` folder, then moves that into place in one step. Any other entry in the archive is ignored, so an archive cannot write outside the recording's folder.
4. Compressed audio is decoded back to the app's own WAVs. The WAV that `afconvert` writes has extra chunks, with the audio starting at byte 4088, so the engine rewrites it with the 44-byte header the rest of the app expects and trims or pads it to the manifest's sample count, padding by at most 1 s: the file comes from someone else, and a crafted sample count must not write gigabytes of silence.
5. **Every size in the file is checked before it is used**, because the file may be crafted: each data file is at most 256 MB inflated and all of them 512 MB together (a two-hour show's are about 3 MB), an entry's declared compressed size must fit in the file, and inflating runs off the main thread. A recording folder that cannot be read is skipped by the library, with a console message, instead of hiding every other recording.
6. The recording keeps its id; another recording with the same id gets `-2`, `-3`, and so on. If the same recording (same id and start time) is already in the library, nothing is added: the page offers to open the one already there, or to **import it again as a copy** under a name (prefilled "<name> (copy)"), which is handy to test an export. The upload is kept for 15 minutes under a one-time `copyToken`, so the copy needs no second upload; `POST /api/sessions/import/:copyToken { name }` imports it as a new recording (`-2`…) with that name.
7. Under a new id, the recording's `session.json` and its session events (`session.started`, `session.ended`, …) are rewritten to name it by that id. The page tells recordings apart by the `sessionId` in those events, so a copy that kept the original's id would never replace the original on screen. `SessionLibrary.events` also corrects any such event whose id does not match its folder, which repairs copies imported before this rewrite.
8. `imported.json` records where it came from. The import window shows the recording's name in a field, so it can be renamed on the spot (`PATCH /api/sessions/:id`).

A two-hour show imports in about 4 s.

**Imported recordings:**
- They open, play back, chat, replay (with audio), export, and delete like any other.
- The Recordings window marks them **Imported** (with the exporting version) and **No audio** when there is none, and shows the version that recorded each recording.
- Their own Cost still shows what they cost when they ran, on the machine that recorded them.

**Delete** removes a recording's folder for good, after an in-page confirmation (`DELETE /api/sessions/:id`). The running session cannot be deleted (409). Deleting the recording on screen opens the one listed below it (or above, if it was the last), or clears the view if none is left.

## Proof of a recording

No file can prove that a conversation happened, or that a transcript is right. What Tattle can prove, and how (`src/store/seal.ts`, `src/store/timestamp.ts`):

- **Integrity.** When a session ends, the engine seals it (`Engine.sealEnded`, after the session's run resolves; `engine.sealed(id)` resolves once it is written). It freezes the transcript into `transcript.jsonl` (the last version of each utterance in `events.jsonl`, in the order it was said, with the speaker's name at that moment, fillers included) and writes `seal.json` with the SHA-256 and size of `host.wav`, `remote.wav`, `transcript.jsonl`, `utterances.jsonl`, and `transcriptions.jsonl`: the files that never change after a recording ends. `events.jsonl`, `speakers.json`, and `meta.json` are left out, because renames, merges, chats, and names change them later.
- **Origin.** The seal's payload (kept as the exact JSON string that was signed) is signed with this Mac's own key: ECDSA P-256 with SHA-256, which every `openssl` can verify, LibreSSL included. The key is made on first use in `~/Library/Application Support/Tattle/signing-key.json` (0600, in a 0700 folder; `TATTLE_SIGNING_KEY` overrides the path, and the tests use it). It identifies a Tattle install, not a person; its fingerprint is the SHA-256 of the public key, shown in groups of four. A key file that cannot be read is an error, never replaced: a new key would make every earlier seal look signed by someone else.
- **Existence in time.** With **trusted timestamps** on (`trustedTimestamps` in `settings.json`, off by default), the payload's SHA-256 is sent to three independent RFC 3161 authorities in three countries (DigiCert, GlobalSign, FreeTSA), at once, with a 15 s timeout. Each returns a signed token saying the hash existed at that time. Only the 32-byte hash leaves the Mac. They are free and need no account. A failure never stops the seal: its reasons are kept in `timestampFailures`, and a seal without timestamps gets them at the next export where they are on (a later time still proves the files existed by then).

A recording from before seals is sealed at its first export (`when: "export"`), and says how long after it was recorded. A seal that fails at the end of a session becomes an `error` event (`component: "seal"`), and the recording itself is complete either way. `checkSeal(dir)` rechecks the signature and every file.

The switch is in the Export window (Transcript only → **Trusted timestamps**). The choice is saved with the export, and it applies to the recordings that follow, as they end.

## Transcript export

**Transcript only**, the fourth choice in the Export window, writes `<name> transcript.txt` (`src/store/transcript.ts`): a plain UTF-8 record meant to be read, filed, or shown as evidence, alongside the original audio.

1. **A header:** name, id, start in local time with its UTC offset and time zone (and in ISO), duration, kind (live or replay), speakers (current names, with the name each had when sealed if it changed since), transcription engine, the versions that recorded and exported it, and when it was exported.
2. **The transcript:** one line per utterance, `[0:12:34 | 14:03:15] Nic: …` (time since the start, then local time). A line that starts a new day is preceded by the date. Line breaks inside a line become spaces.
3. **An integrity record:** when and how the recording was sealed, the key's fingerprint (this Mac or another), the timestamps or why there are none, every sealed file's size and SHA-256, and what the record proves and does not prove (who the speakers are, recognition accuracy, consent, staging, who holds the key).
4. **How to verify,** with `openssl` and no Tattle: the document's signature, the seal's, the files (from an export with original audio), and the timestamps (`openssl ts -verify`, which needs OpenSSL 3; see [Gotchas](gotchas.md#export-and-import)). The first two sets of commands are the `VERIFY_DOCUMENT` and `VERIFY_SEAL` constants, which the tests run as printed, under both LibreSSL and OpenSSL 3.
5. **The seal's data** (`Seal-Payload`, `Seal-Signature`, `Seal-Public-Key`, `Seal-Timestamp-<authority>` lines), then the **signature block**: `-----BEGIN TATTLE SIGNATURE-----`, this Mac's public key, an ECDSA signature over every byte before the block, and the document's own `Timestamp-<authority>` tokens over the SHA-256 of those same bytes (or a `Timestamps:` line saying why there are none).

The document's words are signed when it is exported; the seal ties the recording's files, its frozen transcript included, to when it ended. Opening and re-saving the file in an editor can change invisible characters and break its signature, and the document says so.

## API

| Method | Route | Does |
| --- | --- | --- |
| GET | `/api/sessions?q=&all=1` | List recordings, newest first; with `q`, only matches, each with `matches` |
| GET | `/api/sessions/:id` | One summary |
| PATCH | `/api/sessions/:id` | `{ name?, notes? }` → updated summary |
| GET | `/api/sessions/:id/audio` | The recording's two streams mixed into one WAV, with Range support (`206` / `416`) |
| POST | `/api/sessions/close` | Leaves the opened recording's view; the page's `/` |
| DELETE | `/api/sessions/:id` | Deletes the recording's folder → `{ deleted }`; 409 for the running session |
| POST | `/api/sessions/:id/open` | Reopen read-only → `{ sessionId, events }` (`events` is the number of events loaded); 409 while a session runs |
| POST | `/api/session/start` | `{ mode: "replay", sessionId, speed }` replays a recording; `name` names the new session |
| GET | `/api/sessions/:id/export` | What an export would weigh: `{ fileName, transcriptFileName, recordedWith, app, bytes: { compressed, original, none, transcript }, chats, hasAudio, seal: { when, sealedAt, timestamps } \| null, trustedTimestamps }` |
| POST | `/api/sessions/:id/export` | `{ audio, chats }` or `{ format: "transcript", timestamps }` → `{ token, fileName, bytes }`; `timestamps` is saved as the setting; 400 for another `format` or a `timestamps` that is not a boolean; 409 for a session on air |
| GET | `/api/exports/:token` | The `.tattle` or transcript file, as a download |
| POST | `/api/sessions/import` | The file's bytes (`X-File-Name` header) → `{ summary, already }`, plus `copyToken` when the library already had it |
| POST | `/api/sessions/import/:copyToken` | `{ name }` → imports that kept upload again as a named copy → `{ summary, already: false }`; 404 once used or after 15 minutes |

The web page exposes this as **Recordings** in the settings menu (the cog, top right): a modal with search and match snippets. Click a recording to open it (the modal closes and the recording loads); click its name to rename it in place (Enter or leaving the field saves, Escape cancels); each row has a Replay button and a Delete button (with an "Are you sure?" confirmation).

Related: [Transcription](transcription.md) for live-text cost, [Rehearsal kit](rehearsal.md) for using a recording as the on-air fallback.
