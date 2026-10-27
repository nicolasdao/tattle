import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Label sets live in the user's Application Support; tests never touch it (read by src/paths.ts when it loads).
process.env.TATTLE_LABEL_SETS = mkdtempSync(join(tmpdir(), "tattle-labels-"));
// Nor the user's settings or signing key: an engine reads the one and makes the other when a recording is sealed
// (docs/recordings.md § Proof of a recording).
const appSupport = mkdtempSync(join(tmpdir(), "tattle-app-support-"));
process.env.TATTLE_SETTINGS = join(appSupport, "settings.json");
process.env.TATTLE_SIGNING_KEY = join(appSupport, "signing-key.json");

// Tests never call the network (§7): every client takes its fetch through its constructor, and tests pass fakes.
globalThis.fetch = (() => {
  throw new Error("network disabled in tests");
}) as typeof fetch;

// Nor a WebSocket: live text takes its socket factory through its options too (docs/testing.md).
globalThis.WebSocket = class {
  constructor() {
    throw new Error("network disabled in tests");
  }
} as unknown as typeof WebSocket;
