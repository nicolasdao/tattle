// FS6: export a recording as a .tattle file, then import it back through the file chooser: it is already in the
// library, so it comes back as a copy, which opens under its own id (docs/gotchas.md: a copy's events carry its id).
import { expect, open, test } from "../fixtures.ts";

test.use({ harnessEnv: { E2E_SEED: "library" } });

test("exports with the original audio, and imports the file back as a copy that opens as itself", async ({ page }) => {
  await open(page, "/recordings/20260924-100000");
  await page.locator("#export-btn").click();
  await expect(page.locator("#dlg-export")).toHaveAttribute("open", "");
  await page.getByRole("radio", { name: /Original audio/ }).click();
  await expect(page.getByRole("radio", { name: /Original audio/ })).toHaveAttribute("aria-checked", "true");
  const downloading = page.waitForEvent("download");
  await page.locator("#dlg-export").getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.tattle$/);
  const file = test.info().outputPath(download.suggestedFilename());
  await download.saveAs(file);
  await expect(page.locator(".toast.ok")).toContainText("Exported");

  await page.locator("#import-btn").click();
  await expect(page.locator("#dlg-import")).toHaveAttribute("open", "");
  const choosing = page.waitForEvent("filechooser");
  await page.locator("#dlg-import .drop-zone").click();
  await (await choosing).setFiles(file);
  await expect(page.locator(".import-done b")).toHaveText("You already have this recording");
  await page.getByLabel("Name of the copy").fill("Pilot (copy)");
  await page.getByRole("button", { name: "Import as a copy" }).click();
  await expect(page.locator(".import-done b")).toHaveText("Imported", { timeout: 30_000 }); // it unpacks the audio
  await expect(page.locator(".import-done .import-name")).toHaveText("Pilot (copy)");
  await page.getByRole("button", { name: "Open it" }).click();

  // the copy opens under its own id, not the original's
  await expect(page).toHaveURL(/\/recordings\/20260924-100000-2$/);
  await expect(page.locator("#session-name")).toHaveText("Pilot (copy)");
  await expect(page.locator("#transcript .utt")).toHaveCount(2);
  const list = await page.evaluate(() => fetch("/api/sessions").then((r) => r.json()));
  expect(list.map((s: { id: string }) => s.id).sort()).toEqual(["20260924-100000", "20260924-100000-2", "20260925-090000"]);
});

// docs/recordings.md § Transcript export: the signed text file, through the page and the real engine
test("exports the transcript only, as a signed text file that carries the recording's seal", async ({ page }) => {
  await open(page, "/recordings/20260924-100000");
  await page.locator("#export-btn").click();
  await page.getByRole("radio", { name: /Transcript only/ }).click();
  const stamps = page.getByRole("switch", { name: /Trusted timestamps/ });
  await expect(stamps).toBeVisible();
  await expect(stamps).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("switch", { name: /Include my chats/ })).toBeHidden();
  await expect(page.locator("#export-body .start-summary")).toContainText("transcript.txt");
  await expect(page.locator("#export-body .start-summary")).toContainText("Not sealed yet");
  const downloading = page.waitForEvent("download");
  await page.locator("#dlg-export").getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/ transcript\.txt$/);
  const file = test.info().outputPath("transcript.txt");
  await download.saveAs(file);
  const text = (await import("node:fs")).readFileSync(file, "utf8");
  expect(text).toMatch(/^TATTLE CONVERSATION RECORD\n/);
  expect(text).toContain("END OF TRANSCRIPT: 2 lines");
  expect(text).toMatch(/^Seal-Payload: \{"format":"tattle-seal"/m);
  expect(text).toMatch(/-----BEGIN TATTLE SIGNATURE-----\n[\s\S]*\nSignature: [A-Za-z0-9+/=]+\n-----END TATTLE SIGNATURE-----\n$/);
  await expect(page.locator(".toast.ok")).toContainText("Keep the recording's original audio with it");

  // sealed now: the window says so the next time
  await page.locator("#export-btn").click();
  await page.getByRole("radio", { name: /Transcript only/ }).click();
  await expect(page.locator("#export-body .start-summary")).toContainText("Sealed at its first export");
});
