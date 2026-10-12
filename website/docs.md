# How to use Tattle

> Tattle listens to your calls. It **transcribes** them as people speak, **maps** the conversation on a timeline, and **fact-checks** claims as they're said. This page covers everything it does, from the first launch to the last export.

Last updated 12 Oct 2026 · Tattle for Mac is not affiliated with Tattle Civic Tech (tattle.co.in) or other apps named Tattle.

The web page: https://hey-tattle.com/docs

## 01. Quick start

https://hey-tattle.com/docs#start

Tattle is a Mac app. It hears two sides of a conversation: your microphone, and the call your Mac plays. It works with any call app, because it listens to the Mac's own audio.

| You need | Details |
| --- | --- |
| A Mac with Apple Silicon | M1 or later. Intel Macs are not supported. |
| macOS 14.2 or later | macOS 26 or later transcribes on the Mac itself, for free. macOS 14.2 to 25 transcribes with OpenAI. |
| Earbuds or headphones | Recommended: they keep the call out of your microphone. See [speaker mode](https://hey-tattle.com/docs#speaker-mode). |
| Accounts | None for transcripts on macOS 26+. An OpenRouter key for fact-checking, labels, and Chat. An OpenAI key on older macOS. See [Keys and accounts](https://hey-tattle.com/docs#keys). |

1. **Download** the DMG from the button above (or [GitHub Releases](https://github.com/nicolasdao/tattle/releases/latest)) and drag **Tattle** into Applications.
2. **Open it** and click **Allow** for Microphone and System Audio Recording.
3. On older macOS, **paste an OpenAI key** on the setup screen. On macOS 26 or later there is nothing to paste.
4. Press **Start live**, choose what runs (transcript, fact-check, labels), and press **Start live** again.
5. Talk. Lines appear as people speak; name each speaker by clicking their name.
6. Press **Stop**. The show becomes a recording you can reopen, play back, chat about, and export.

## 02. Install

https://hey-tattle.com/docs#install

1. Download `Tattle-<version>-arm64.dmg` from [GitHub Releases](https://github.com/nicolasdao/tattle/releases/latest), the only official source.
2. Open the DMG and drag **Tattle** into Applications.
3. Open Tattle from Applications. macOS asks once whether to open an app downloaded from the internet: it is signed and notarized by Apple.
4. On macOS 26 or later, the app opens straight away and prepares on-device speech recognition in the background (a one-time download managed by macOS). On older macOS, the setup screen asks for an OpenAI key.

Only one copy runs at a time: opening Tattle again brings its window forward. Closing the window keeps the app, and any show, running; click the Dock icon to bring it back.

### Permissions

On the first launch a sheet says **Tattle needs two permissions**. Click **Continue**, then **Allow** on both macOS prompts:

- **Microphone**: "Tattle transcribes the host's microphone during a recording."
- **System Audio Recording**: "Tattle transcribes the call audio (co-hosts and guests) that the Mac plays during a recording."

Asking up front means the prompts never interrupt a show. If the microphone is later turned off, every launch shows **The microphone is turned off for Tattle**, with **Open System Settings** (Privacy & Security → Microphone: turn on Tattle, then quit and reopen it) or **Not now**.

**Note: A refused System Audio permission is silent.**

macOS gives Tattle pure silence instead of an error, so the app cannot warn you in advance. The sign is the call's meter in the header turning red with **silent N s**. Fix it in System Settings → Privacy & Security → System Audio Recording.

### Coming from Conversation Assistant

It is the same app, renamed. It updates itself to Tattle and moves your keys and recordings with it. After **Restart Now** on that one update, open **Tattle** from Applications yourself: it does not reopen on its own that once. If you install the DMG instead, delete `Conversation Assistant.app`.

### Check your download is genuine

Tattle is signed by **Developer ID Application: Nicolas Dao (UX774V7BK2)** and notarized by Apple. In Terminal:

```sh
codesign -dv "/Applications/Tattle.app" 2>&1 | grep TeamIdentifier   # TeamIdentifier=UX774V7BK2
spctl --assess -vv "/Applications/Tattle.app"                        # source=Notarized Developer ID
shasum -a 256 Tattle-<version>-arm64.dmg                             # matches the checksum in the release notes
```

The DMG itself is not signed (the app inside is), so `spctl` on the DMG saying "no usable signature" is expected. A copy from anywhere else, or signed by anyone else, is not the official one.

## 03. Keys and accounts

https://hey-tattle.com/docs#keys

Tattle has no account and no server of its own. Paid features use your own keys with two services, paid directly by you, only for what you use.

| Key | What needs it | Where to get it |
| --- | --- | --- |
| None | Transcripts on macOS 26 or later (Apple Speech), speakers, the timeline's segments, recordings, playback, export and import | — |
| OpenAI | Transcription on macOS 14.2 to 25, or when you pick the OpenAI engine | [platform.openai.com](https://platform.openai.com), with prepaid credit. Keys start with `sk-` |
| OpenRouter | Fact-checking, labels, Chat, Create with AI, and Try on a recording | [openrouter.ai](https://openrouter.ai), with prepaid credit. Keys start with `sk-or-` |

### The OpenAI key on first launch

The setup screen, **Add your OpenAI API key to start**, appears only when OpenAI is the transcription engine and no key is saved (on macOS 14.2 to 25, or if you chose OpenAI). Paste the key into **OpenAI API key** and press **Save key and start**. The fold **How do I get an OpenAI key? About 5 minutes** walks you through it:

1. Sign up at platform.openai.com. It is separate from a ChatGPT subscription.
2. Settings → Billing → Add to credit balance. $10 is plenty; leave automatic recharge off.
3. API keys → Create new secret key, named Tattle, in the default project, with All permissions. It is shown only once: copy it.

A transcript costs about $1.23 an hour of show. After saving: **All set. Opening Tattle…**

### The OpenRouter key, when you first need it

Nothing asks for OpenRouter until you turn on a feature that needs it. A card then appears in place, with the guide open, a **Save** button and sometimes **Not now**:

- In **Start live**, turning on Fact-check or picking a label set: "Please provide your OpenRouter API key to configure fact-checking or labeling." **Not now** turns both off.
- Opening Chat: "Please provide your OpenRouter API key to use Chat."
- Labels → Try on a recording, and Labels → Create with AI.

The guide: sign up at openrouter.ai, Settings → Credits ($10, auto top-up off), Settings → API keys, name it Tattle, and **give it a credit limit** such as $10. The app sets no spending limit of its own: the key's limit is the one that stops a mistake.

### How a key is checked

Before saving, Tattle makes a free request to the service with the key (10 s at most). It refuses a key that is empty, has spaces or line breaks, looks cut short, belongs to the other service, or that the service rejects ("OpenAI does not accept this key. Check it was copied whole, and not revoked."). It saves the key with a warning when:

- it cannot reach the service ("Could not reach the service to check it (are you online?). It was saved anyway.");
- an OpenRouter account has no credit yet, or the key has no credit limit;
- an OpenAI key cannot use the transcription models (check the project's model permissions).

A working key shows **✓ Key works**, and for OpenRouter the limit and what is left. An OpenAI account with no credit cannot be detected in advance: it fails on the first transcription (see [Troubleshooting](https://hey-tattle.com/docs#troubleshooting)).

### Change or remove a key

**Tattle → Settings…** (`⌘,`) opens the **API keys** window: one card per key, showing **Saved · …abcd** (the last four characters only). Paste a new key and press **Save**; it is checked, then used from the next call, with no restart. There is no button to remove a key: delete it from `~/Library/Application Support/Tattle/credentials.json` (see [Where files live](https://hey-tattle.com/docs#files)).

Keys stay on your Mac, in a file only your macOS user can read. They never appear in logs, recordings, exports, or anywhere else, and each is sent only to its own service.

## 04. Transcription engines

https://hey-tattle.com/docs#transcription

Two engines turn speech into text. Choose one in the cog menu (top right) → **Transcription**.

|  | On this Mac (Apple Speech) | OpenAI |
| --- | --- | --- |
| Needs | macOS 26 or later | An OpenAI key with credit |
| Cost | Free | About $1.23 an hour of show |
| Privacy | Audio never leaves your Mac | Audio is sent to OpenAI during a session |
| Accuracy | Less accurate on names and jargon ("Jev" can come out as "Jeff") | More accurate on names and jargon |
| Live text | About 2 s after speech starts; the final line about 1 s after it ends | About 1.2 s after speech starts; the final line about 2.5 s after it ends |
| Offline | Yes, once its speech model has downloaded, for a transcript-only session | No |

The first time, Tattle picks for you: Apple Speech on macOS 26 or later, OpenAI on older macOS (or if you already had an OpenAI key from an earlier version). The choice is saved and applies to the next session: a session keeps the engine it started with, and the window is read-only while one is on air ("A session is on air: the engine can be changed when it ends.").

### The on-device speech model

Apple Speech needs a speech model that macOS downloads once. Tattle starts it at launch; the Transcription window shows **Getting ready…**, then **Getting on-device speech recognition ready… N %**, then **Ready**. Everything but **Start live** works in the meantime. If it fails, the error appears with **Try again**.

All transcription is in English (US English for Apple Speech).

## 05. Going live

https://hey-tattle.com/docs#session

Press **Start live** in the header. The window, **Choose what runs during this show**, has:

| Option | What it does |
| --- | --- |
| Microphone | Your mic. **Built-in microphone**, then every other input with its connection (USB, Bluetooth…). Plugged in after launch? It is listed next time the window opens. The last one used is preselected. |
| People on the call | **Any number**, or **1 on the call** to **4 on the call**. Voices beyond this count go to the closest speaker instead of becoming new ones. It resets to Any number each time. Your mic always counts one voice. |
| Transcript | **Always on**: both streams recorded and transcribed live, speakers identified, a timeline, and chat. |
| Fact-check | System 1 (Jev) flags checkable claims on every line; System 2 (GPT-6 Luna) researches them with sources. On by default when your OpenRouter key is set. |
| Labels | A label set, or **Off**. Jev labels each part of the timeline with its questions. Defaults to the set you used last, or the built-in **AI podcast**; Off without an OpenRouter key. |
| Tonight's stories (optional) | Shown when a label set is picked: one headline per line (254 at most, 300 characters each). Jev says which story each part of the show is about, and the headlines help OpenAI spell names. |

A summary line says what runs and what it costs: **Everything on · labels: AI podcast**, **No fact-checking**, **No labels**, or **Transcript only: Jev and System 2 are not called**, then **Free: nothing leaves this Mac.** or **About $X an hour** (with "at most" when fact-checking is on). With Fact-check off and Labels off, the session is **transcript only**.

Press **Start live**. What you choose is fixed until the session ends: a feature turned off stays off. **Pause**, **Resume**, **Stop**, and Chat work either way. With Apple Speech, **Start live** waits until the speech model is ready.

### Pause, resume, stop

- **Pause** turns incoming audio into silence until you resume: nothing is heard, transcribed, or spent, and the recording stays in time. The timeline shows hatched bands for paused stretches. Replays cannot be paused.
- **Resume** starts listening again.
- **Stop** ends the show. Tattle finishes the lines still being transcribed (and retries failed ones once more), labels the last segment, and waits up to 3 minutes for fact-checks in progress. Then the session becomes a recording, on screen.

While a session is on air your Mac does not go to sleep (the screen still can), updates wait, and quitting asks first: **A session is on air**, with **Stop and Quit** or **Cancel**. To keep every line, press Stop and wait for the session to end before quitting.

### Speaker mode

If the call plays through the Mac's speakers, your microphone hears it too, and the guests would be transcribed twice. Tattle notices and turns on **speaker mode**: a **Speakers** chip appears in the header, and your microphone is muted while the call plays, and for a quarter of a second after. Anything you say over a guest in that time is not transcribed or recorded, and your meter reads **muted · call playing**.

Speaker mode turns off by itself as soon as earbuds or headphones are connected. For the best transcript, wear earbuds. Tattle cannot tell a Bluetooth speaker from Bluetooth earbuds, so with a Bluetooth speaker it treats the audio as headphones and leaves the microphone open.

## 06. The header

https://hey-tattle.com/docs#header

| Part | What it shows |
| --- | --- |
| The ON AIR block | **On air** (red), **Paused** (orange), **Replay** (cyan), or **Stopping**. Hidden when nothing is running. |
| Session name | **No session**, or the session's name. Click it to rename (120 characters at most); Enter or clicking away saves, Esc cancels. Works on air and on recordings. |
| Features chip | **Transcript only**, **No fact-check**, or **No labels** when a feature is off for this session. |
| Connection dot | Whether the page is receiving the engine's events. |
| Clock | Time since the session started (paused time included). |
| Meters | **Host** (your mic, light blue) and **Remote** (the call, pink): the device, a level bar from −60 to 0 dBFS, and the level and delay, or **waiting…**, **paused**, **muted · call playing**, **silent N s**. A meter turns **red** when its stream stays at or below −50 dBFS for more than 10 s, or sends nothing for more than 3 s. |
| Speakers chip | Speaker mode is on (see [Speaker mode](https://hey-tattle.com/docs#speaker-mode)). Hover it for the details. |
| Spend / Cost | **Spend $X** on air, **Cost $X** for a recording. Hover or focus it for the split: Transcription, Jev, System 2, Chat. It turns red with **OpenRouter stopped** if OpenRouter refuses for good (out of credit or over the key's limit). |
| Buttons | **Start live**, **Pause** / **Resume**, **Stop**, **Export** (on a recording), **Import** (when nothing is on air), **Chat** (a dot pulses while a reply is being written), and the cog. |

### The cog menu

- **Recordings**: open, rename, replay, export, delete (see [Recordings](https://hey-tattle.com/docs#recordings)).
- **Insights**: stats, the fact-checker, and the error log (see [Insights](https://hey-tattle.com/docs#insights)).
- **Speakers**: rename and merge voices (needs a session or a recording).
- **Labels**: your label sets (see [Label sets](https://hey-tattle.com/docs#label-sets)).
- **Transcription**: the engine (see [Transcription engines](https://hey-tattle.com/docs#transcription)).

The window's layout: the transcript on the left, a right column with three tabs (**Fact-check**, **Fast · slow thinking**, **Jev log**), and the timeline along the bottom. Drag the divider between the two columns (25% to 75%; `←` `→` move it, double-click resets it), and drag the timeline's top edge to resize it (`↑` `↓`, double-click resets). The app remembers both, your right-column tab, your microphone, and your last label set.

## 07. The transcript

https://hey-tattle.com/docs#transcript

Each line shows its time, the speaker's name tab (once per run of lines by the same speaker; your mic in light blue, the call in pink), and the text. It scrolls with the conversation while you are near the bottom.

- **Live text** (grey italic, with a red dot) streams while someone speaks; the final line replaces it. Its speaker reads **Host** or **Call**, or the name when that stream has had only one speaker so far.
- **Inferred speakers** show as **Name ***: the line was under 1.5 s, too short for a voiceprint, so the speaker was inferred.
- **Fillers** ("uh", "yeah", "ok"…) are dimmed. A **LOUD** tag marks a line at least 6 dB louder than that stream's recent median.
- **Flagged claims** get an orange tint and a flag: Jev sent them to be fact-checked. The verdict appears on the fact-check card, not in the transcript.
- **Segment dividers** mark where the timeline's segments start: the time, the first category's option as a coloured tag (faded when Jev was unsure), marker icons, and companies mentioned.

### Lines that could not be transcribed

If the connection drops, a line keeps its place and reads Not transcribed yet: the connection dropped. Retrying…. Tattle retries every 15 s and once more at the end. A line that still fails reads **Not transcribed.** (on a recording, **Not transcribed. Play from here to hear it.**): the audio is kept.

### Filters

Under the transcript, a chip per marker (Hot take, Prediction…) and, on the right, **All speakers** and one menu per category (**All subjects**, **All modes**; grouped options such as **AI (all)**), then **Clear**. The speaker filter hides other speakers' lines; the marker and category filters hide lines outside matching segments and dim those segments on the timeline. Live text is hidden while a marker or category filter is on. Filters reset when the label set changes.

## 08. Speakers

https://hey-tattle.com/docs#speakers

Each voice becomes a speaker, **Speaker 1**, **Speaker 2**…, from a voiceprint made on your Mac (lines of 1.5 s or more). Voices are compared only within their own stream: your mic holds one voice, the call as many as **People on the call** allows. Once a stream is at its limit, a new voice goes to the closest speaker. Renames and merges work on air, after the show, and on reopened recordings, and are saved with the recording.

### Rename or merge one speaker

Click a name in the transcript. The window shows their lines, talk time, and stream (**on your mic** or **the call**):

- **Name**, then **Rename** (or Enter).
- **"Name is really…"**: pick a speaker and press **Merge A into B**. A's lines move to B, and A disappears.
- **"…is really Name"**: the other way round; the other speaker's lines move here and this name is kept.

These merges apply immediately, without a confirmation.

### The Speakers window

Cog → **Speakers** lists every voice with a name field, **Rename**, a **Merge into…** menu and **Merge** (which asks first), and their talk time.

### Find duplicate speakers

When one person was split into two speakers, **Find duplicates** compares every voice with the others on the same stream and proposes merges, each with **High**, **Medium**, or **Low confidence** and a voice-match score. Nothing merges until you click. Set how many people were on the call first (1 to 4, or Any number). A two-hour recording takes about half a minute. Merge one suggestion at a time, **Merge N high & medium**, or **Merge all N**; the last two ask first. Speakers you renamed are kept, and preferred as the name that stays.

## 09. The timeline

https://hey-tattle.com/docs#timeline

The conversation is cut into **segments** of 12 to 75 seconds, where the topic changes. With labels on, Jev labels each segment with the label set's questions when it closes. The lanes, top to bottom (with the built-in **AI podcast** set):

| Lane | What it shows |
| --- | --- |
| Section brackets | Runs of segments with the same first-category option. |
| First category | A coloured block per segment, e.g. **Subject**: AI models, AI tools, AI industry, Tech, Marketing, Personal life, Other topics, The show. |
| Second category | e.g. **Mode**: News, Analysis, Personal story, Explainer, Banter, Transition, Other. |
| Scores chart | Up to two lines on a 0–4 scale, e.g. **Heat** (orange) and **Hype** (yellow). |
| Markers | A pin where Jev said yes, e.g. Disagreement, Hot take, Prediction, Recommendation, Clip-worthy, Humour. |
| Time axis | With a **Now** line on air, **End** on a recording. |

With labels off, a single **Segments** lane replaces the categories, and the legend reads Labels off for this session: segments and time only. The segment still being spoken is drawn as **In progress**. A faded block means Jev was less sure than the set's threshold; an outline means it is not labelled (yet).

- **Hover** a block or pin for its time, option, confidence, story, and companies mentioned.
- **Click** one to jump the transcript there (and, on a recording, move playback to it). A segment hidden by filters says so.
- **Zoom** with **−** / **+**, **Fit** (the whole show), or `⌘` + scroll or a pinch. The closest zoom shows about 30 s. Scroll to move through time. On air, it follows now while you are at the end.
- **Resize** the chart by dragging its top edge.

How segments close: when Jev says the topic changed (and the segment is at least 12 s long), and always before 75 s. With Jev off (transcript only), a segment closes at a 2-second pause once it is at least 12 s long.

## 10. Fact-checking

https://hey-tattle.com/docs#fact-checking

Needs: OpenRouter key · Up to about $0.35 an hour

Fact-checking works in two steps, like fast and slow thinking. **System 1** is Jev, a fast decision model from TypeSafe AI: on every line it answers a few typed questions (is it a checkable claim, about the public world, worth checking, is the speaker unsure) in under a second. **System 2** is GPT-6 Luna with web search: it researches only the claims System 1 flags, and returns a verdict with sources within seconds.

### The verdicts

| Verdict | Meaning |
| --- | --- |
| Supported | The sources back the claim. |
| False | The sources contradict it. A short correction follows. |
| Misleading | True in part, or true but misleading as said. |
| Unverifiable | No reliable source settles it. A Supported, False, or Misleading verdict with no source found becomes Unverifiable. |
| Not a claim | On inspection, not a checkable claim: a false alarm by System 1. |
| Checking | Being researched now. **Queued**: waiting its turn. |

### The fact-check tab

The **Fact-check** tab lists claims, most recent first, with a tally (**N false**, **N misleading**, **N supported**, **N checking**). Each card shows the speaker, the steps **Queued** → **Researching** → the verdict, its confidence and research time, the line as said, the claim restated, a correction of 25 words at most, and up to three sources.

- **Repeats**: a claim said again is linked to the first card (**Repeat ×N**) instead of being researched twice.
- **Host disputes**: click it on a card to disagree with a verdict, with an optional note. The card dims, and its grade no longer counts as evidence for System 2.
- **Dropped**: a claim can be dropped when it waited more than 10 minutes, the session's cap was reached, the session stopped, or research failed.

**Note: Verdicts can be wrong.**

They come from AI models. Treat them as leads to check, not as facts.

### What gets checked, and how much

- A line is flagged when Jev is confident it is a checkable claim about the public world, worth checking. Fillers, untranscribed lines, and lines Jev did not answer in time (3 s) are skipped.
- Research runs two at a time, the most worth-checking first, up to 30 an hour and 40 per session.
- **Audits**: every 5 minutes, if at least 10 unflagged lines have piled up, System 2 reviews a sample of 10 for claims System 1 missed. Audits make no cards; they count as Misses in Insights.
- **System 2 improves System 1**: after 3 false alarms or 2 misses, System 2 rewrites System 1's questions. The rewrite is kept only if a replay of the session so far shows it fixes an error while keeping at least 90% of the good flags. Every session starts from the default questions, `s1@1`; roll back in Insights.

## 11. Fast · slow thinking

https://hey-tattle.com/docs#thinking

The right column's second tab shows the two systems at work: **System 1 · fast** (Jev, "Judges every line in under a second") and **System 2 · slow** (GPT-6 Luna, "Researches only what System 1 flags"), each **Thinking** or **Idle**, with its calls, average time, cost per call, and total.

- **The value box**: how much cheaper System 1 made the show ("N× cheaper with System 1"), against asking System 2 about every line.
- **From every line to a verdict**: lines heard, checked by Jev, flagged, researched, and the verdicts.
- **Claims handed from System 1 to System 2**: each claim's trip, with its time and cost at each step. Click a row for the exact requests.

## 12. Jev log

https://hey-tattle.com/docs#jev-log

The third tab lists every call to Jev, newest first (the latest 200 on screen): the time, the purpose (**Line check**, **Topic labels**, **Rewrite test**, **Relabel**), what Jev was shown, the latency, the cost, its key answers ("Yes (93%)", "Analysis (81% sure)", "2.3 of 4"), and what the app did next (**→ Flagged: sent to System 2**, **→ Already checked**, **→ Not flagged**, **→ No answer in time**). Click a call for every answer and the exact HTTP request and response.

## 13. Insights

https://hey-tattle.com/docs#insights

Cog → **Insights**, updated every minute and at the end of the show. Three tabs:

- **Overview**: the label set's index as a big percentage (with the built-in set, **Off-topic**: time on personal life and other topics), a bar per category, a table per speaker (talk time, per-speaker markers such as Disagreements, score averages), and lists of listed markers (Predictions, Recommendations, Clip-worthy), each entry jumping to its moment.
- **Fact-checker**: System 1's version (`s1@N`), flags, good flags, false alarms, misses, repeats, the verdicts, what System 2 researched, the rewrites promoted or rejected with their gate results, and **Roll back to** an earlier version.
- **Log**: the last 30 errors (component, time, message). The tab's count turns red when there are any.

## 14. Label sets

https://hey-tattle.com/docs#label-sets

Needs: Making one: free · Using one: OpenRouter key

A label set is what the timeline asks Jev about each segment of a show. Pick one in **Start live**. Sets are files on your Mac: making or editing one sends nothing anywhere.

| Kind | How many | What it does |
| --- | --- | --- |
| Categories | 0 to 2 | Jev picks one option per segment (2 to 255 options, each with a name, a description Jev reads, a colour, an optional group). One option must be a fallback, named Other or None. Each draws a lane and a filter; the first draws the section brackets. One category may have an **index**: the share of time on chosen options, shown in Insights. |
| Scores | 0 to 2 | Exactly 5 levels, lowest first, drawn as a 0–4 line (the first in the heat colour, the second in the hype colour) and averaged per speaker. |
| Markers | 0 to 8 | A yes/no question: a pin with one of 30 icons when Jev's yes probability reaches its threshold (0.50–0.95). Optionally counted per speaker, or listed in Insights. |

A set also has a name, a description, a prefix before every question, companies to spot (whole words, found by code, up to 200), and a "Fade choices less sure than" threshold. It needs at least one label. The editor shows the estimated cost ("About $X per hour · N tokens per call of 32,000") and every rule broken.

### The built-in set: AI podcast

Made for a podcast about AI and read-only: **Subject** (with the Off-topic index) and **Mode**, **Heat** and **Hype**, and six markers (Disagreement, Hot take, Prediction, Recommendation, Clip-worthy, Humour). It spots OpenAI, Anthropic, Google, Meta, Nvidia, TypeSafe, OpenRouter, DeepSeek, and Hugging Face. **Clone** it to make an editable copy.

### The Labels window

Cog → **Labels** works without a session or a key. The built-in set comes first (**Clone**, **Export**), then yours by name: click a name to rename it, **Edit**, **Export**, and × to delete (recordings made with it keep their own copy). A file that fails its checks is listed as **Broken** and left out of Start live. At the top: **New**, **Import**, and **Create with AI**.

The editor has a card per category, score, and marker (**Add category (n of 2)**, **Add score (n of 2)**, **Add marker (n of 8)**), a locked card for where segments end (the same, calibrated question for every set), and "How to write good labels". **Save** and **Try on a recording** stay disabled until the set is valid. To copy one of your own sets, export it and import it again.

### Create with AI

Needs: OpenRouter key · A few cents

GPT-6 Luna drafts a set with you, one question at a time, while the editor on the right fills in. It starts by asking what kind of conversation you will label (**A podcast about a topic**, **A sales or customer call**, **A team meeting**, **A job interview**, or your own words), proposes options, levels, wording, thresholds, and icons, and explains anything you ask about. Click a suggested answer or type your own; your edits in the editor win. A checklist tracks what the set still needs (**Still to settle: N**, then **Ready: try it on a recording, then save**). The cost so far shows as **Spent $X**. Nothing is saved until you press **Save**; closing the window discards the conversation.

### Try on a recording

Needs: OpenRouter key · Shown before you start

From the editor or Create with AI: pick a recording, and Jev is asked the draft's questions about each segment that starts in its first 10 minutes (40 at most). The result shows two small timelines, the recording's own labels and the draft's, with the cost. Nothing is saved into the recording. Not available while a session is on air.

### Share a set

**Export** saves a set as one `.tattle-labels` file in Downloads. To add one someone sent you, use **Import** in the Labels window, or drop the file anywhere on the app. A name already taken becomes "Name (2)".

### The copy each recording keeps

When a show starts, the whole set is copied into the recording, with tonight's stories. Editing or deleting the set later never changes past recordings, and the copy travels inside exports.

## 15. Chat

https://hey-tattle.com/docs#chat

Needs: OpenRouter key · About $0.004 a question with GPT-6 Luna on a 2-hour show

Ask questions about the transcript of the show on screen, live or afterwards. Open it with **Chat** in the header or `⌘K` from anywhere.

- The transcript is attached. On air, each question also brings every line said since the last one, so answers cover the show up to the moment you ask.
- Starters: **Summarise the conversation so far.**, What were the main disagreements, and who took which side?, and more.
- Answers cite moments as `[m:ss]`: click one to jump there (on a recording, playback moves there and the chat stays open).
- Chats are kept per recording, in a sidebar: **+ New chat**, rename, delete. A chat is created only with its first question, so opening Chat costs nothing.
- **Stop** a reply with the **Stop** button or `Esc`; it keeps what was written. **Copy** any message, **Edit** your last question (or `↑` in an empty box), **Regenerate** the last answer.
- A reply keeps going if you close the window, and is saved.
- A meter shows the context used, tokens in and out, and what this chat and the recording cost. Past 80% of the model's context, it suggests a new chat.

### Models

Click the model button to pick one. Search by name, and sort by **Suggested**, **Cheapest**, **Priciest**, or **Largest context**; the list shows each model's context and prices per million tokens, from OpenRouter. Switching mid-chat sends the whole conversation to the new model with the next question.

| Model | OpenRouter id |
| --- | --- |
| GPT-6 Luna (default) | `openai/gpt-6-luna` |
| GPT-6 Sol | `openai/gpt-6-sol` |
| GPT-6 Astra | `openai/gpt-6-astra` |
| Claude Sonnet 5 | `anthropic/claude-sonnet-5` |
| Claude Opus 5.5 | `anthropic/claude-opus-5.5` |
| Claude Fable 5.1 | `anthropic/claude-fable-5.1` |
| Gemini 3.8 Flash | `google/gemini-3.8-flash` |
| Grok 4.7 | `x-ai/grok-4.7` |
| DeepSeek V4.1 Flash | `deepseek/deepseek-v4.1-flash` |
| Kimi K3 | `moonshotai/kimi-k3` |
| Qwen3.8 Max Prime | `qwen/qwen3.8-max-prime` |
| GLM 5.3 | `z-ai/glm-5.3` |
| Muse Spark 1.3 | `meta/muse-spark-1.3` |
| Mistral Large 2512 | `mistralai/mistral-large-2512` |

Every call asks providers not to collect your data. If no provider of a model accepts that, pick another model.

## 16. Recordings

https://hey-tattle.com/docs#recordings

Every show is saved as a recording. Cog → **Recordings** lists them newest first, each with its name (or date), duration, lines, speakers, claims, cost, and the version that recorded it. Badges: **Viewing**, **Current**, **Incomplete** (it stopped abruptly), **Imported**, **No audio**.

- **Open**: click a row. The recording reopens exactly as it was, instantly and for free: nothing is processed again. You can still rename and merge speakers, and chat about it.
- **Search** names and transcripts: a recording matches when every word is in its name or speakers, or all in one line; up to 5 matching lines show under it.
- **Rename**: click its name (120 characters at most; clear it to show the date again).
- **Delete**: the trash button, after a confirmation. It removes the audio, transcript, fact-checks, chats, and every other file, for good.
- **Show Recordings in Finder**: in the File menu.

A recording on screen shows **Cost** instead of Spend, an **Export** button, and no meters. Stop the show on air before opening another recording.

### Replay

Needs: About what the show cost

**Replay** runs a recording's audio through the whole pipeline again, in real time, as a new recording (the original is untouched). It uses the transcription engine selected now and the label set last picked in Start live, with fact-checking on when an OpenRouter key is set (transcript only otherwise). Results can differ, since the AI models are not deterministic. To look at a show again, **Open** it instead: it is free.

## 17. Playback

https://hey-tattle.com/docs#playback

A recording with audio has a player in the timeline's header: **Play** / **Pause** (or `Space`), speed (1×, 1.25×, 1.5×, 2×, 3×, 4×; voices keep their pitch), a volume boost up to 300%, and the time. Your mic and the call play mixed, each levelled to the same loudness.

- Move playback by clicking the timeline, a segment, a marker pin, a line's time in the transcript, or a time cited in Chat.
- The line being heard is highlighted and kept in view (scroll yourself and it waits 4 s).
- Speed and volume are remembered.

## 18. Export and import

https://hey-tattle.com/docs#export-import

**Export** (in the header, or on a row in Recordings) saves a recording as one `.tattle` file in Downloads, to send by WhatsApp, email, or a cloud drive.

| Audio | What you get | A two-hour show |
| --- | --- | --- |
| Compressed audio (default) | Sounds the same for speech; the best way to share. | About 57 MB |
| Original audio | Exactly as recorded, lossless. | About 450 MB |
| No audio | Transcript, timeline, fact-checks, and speakers; no playback or replay. | About 3 MB |

**Include my chats** is off by default: they are your own questions. The window says whether the file fits email (24 MB), WhatsApp (2 GB), or needs a cloud drive.

### Import

**Import** in the header (or in Recordings), or drop a `.tattle` file anywhere on the app. Files from the app's earlier names (`.conversation-recording`, `.podcast-recording`) import too. Then rename it or **Open it**. Importing a recording you already have offers **Open the one I have** or **Import as a copy**. An imported recording works like your own; its cost is what it cost whoever recorded it. Files are 4 GB at most, and a recording from a newer version of Tattle asks you to update first.

## 19. Costs

https://hey-tattle.com/docs#costs

Tattle itself is free. Paid calls go to your own accounts, and the header shows the spend as it happens.

| What | Cost |
| --- | --- |
| Transcription, Apple Speech | Free |
| Transcription, OpenAI | About $1.23 an hour of show |
| Jev (line checks and labels) | About $0.03–0.04 an hour |
| Fact-checking research | Up to about $0.35 an hour (30 an hour, 40 per session at most) |
| Everything on, with OpenAI | About $1.60 an hour |
| Everything on, with Apple Speech | Up to about $0.40 an hour |
| Transcript only, with Apple Speech | $0 |
| Chat | Per question, by model (about $0.004 with GPT-6 Luna on a 2-hour show) |
| Opening a recording | Free |
| Replay | About what the show cost |
| Try on a recording, Create with AI | Shown before and as you go; not added to any recording |

**Note: No spending limit in the app.**

The app shows what it spends but does not stop. Give your OpenRouter key a credit limit (for example $10) at openrouter.ai/settings/keys, and keep OpenAI on prepaid credit with automatic recharge off.

## 20. Privacy

https://hey-tattle.com/docs#privacy

No server of our own, no account, no analytics, no telemetry. Nothing goes to the authors. What leaves your Mac, and when:

| What | Sent to | When |
| --- | --- | --- |
| The conversation's audio | OpenAI, with your key | Only with the OpenAI engine, during a session or replay, never while paused. With Apple Speech, audio never leaves your Mac. |
| Transcript lines | OpenRouter, with your key | With fact-checking or labels on (Jev's questions, GPT-6 Luna's research and audits) |
| Your chat questions, with the transcript | OpenRouter, to the model you pick | When you ask |
| The first 10 minutes of a transcript; your show description and draft set | OpenRouter | Try on a recording; Create with AI |
| A key being checked | Its own service | When you save it |
| An update check | GitHub | At launch and every 4 hours, never on air |

Calls to OpenRouter ask providers not to collect your data. A transcript-only show on Apple Speech sends nothing anywhere.

**Note: Record with consent.**

Tattle records and transcribes everyone on a call. Many places require the consent of everyone recorded, and some require it to be explicit: tell the people on the call, and get their consent, before you record. You are responsible for how you use the app and its recordings.

## 21. Where files live

https://hey-tattle.com/docs#files

| What | Where |
| --- | --- |
| The app | `/Applications/Tattle.app` |
| Recordings | `~/Library/Application Support/Tattle/sessions/`, one folder per show of plain, readable files (File → Show Recordings in Finder) |
| Your keys | `~/Library/Application Support/Tattle/credentials.json`, readable only by your macOS user |
| The engine choice | `~/Library/Application Support/Tattle/settings.json` |
| Your label sets | `~/Library/Application Support/Tattle/labels/`, one file per set |
| Exports | Downloads, as `name.tattle` or `name.tattle-labels` (then "name (2)") |
| The Apple Speech model | Managed by macOS |

## 22. Updates

https://hey-tattle.com/docs#updates

Tattle updates itself from GitHub Releases. It checks at launch and every 4 hours, downloads a new version in the background (the Dock icon shows the progress), and when nothing is on air asks **Tattle X is ready**: **Restart Now**, or **Later** to install it the next time you quit. It never checks, and never asks, while a session is on air; a download already under way finishes in the background.

**Tattle → Check for Updates…** checks now (it reads **Checking for Updates…** while it works). You may see:

- **You're up to date**;
- **A new version is available**, with **Download and Install**, **Later**, and **Release Notes**;
- **Updates wait until the show ends**, on air;
- **Can't check for updates right now** or **The download failed**: check the connection and try again later.

Permissions, keys, and recordings carry over. See what changed in the [changelog](https://github.com/nicolasdao/tattle/blob/master/CHANGELOG.md).

## 23. Menu bar

https://hey-tattle.com/docs#menus

| Menu | Items |
| --- | --- |
| Tattle | About Tattle · Check for Updates… · Settings… (`⌘,`, the API keys) · Services · Hide Tattle (`⌘H`) · Hide Others · Show All · Quit Tattle (`⌘Q`) |
| File | Show Recordings in Finder · Close Window (`⌘W`) |
| Edit | Undo, Redo, Cut, Copy, Paste, Paste and Match Style, Delete, Select All, Speech |
| View | Reload (`⌘R`), Force Reload, Actual Size (`⌘0`), Zoom In (`⌘+`), Zoom Out (`⌘−`), Toggle Full Screen (`⌃⌘F`) |
| Window | Minimize (`⌘M`), Zoom, Bring All to Front |
| Help | Tattle on GitHub · Licenses and Acknowledgements |

**About Tattle** shows the version. **Licenses and Acknowledgements** opens a window listing every component the app includes with its licence, searchable, with the license files in Finder.

## 24. Keyboard shortcuts

https://hey-tattle.com/docs#shortcuts

| Keys | Does |
| --- | --- |
| `⌘K` | Open Chat, from anywhere |
| `⌘,` | Settings…: the API keys |
| `Space` | Play or pause a recording (not while typing or in a window) |
| `Enter` | Send a chat message; save a rename or a key |
| `Shift` `Enter` | A new line in a chat message |
| `↑` in an empty chat box | Edit your last question |
| `Esc` | Close a window or menu; cancel a rename or an edit; stop a chat reply |
| `⌘` + scroll, or pinch | Zoom the timeline |
| `←` `→` on the column divider | Move it |
| `↑` `↓` on the timeline's edge | Resize the chart |
| `↑` `↓` `Home` `End` in a menu | Move through its options; type to jump to one |
| `⌘W` | Close the window (the app and any show keep running) |
| `⌘Q` | Quit (asks first while a session is on air) |

## 25. Links into the app

https://hey-tattle.com/docs#links

When you run Tattle from source in a browser (see [Run it from source](https://hey-tattle.com/docs#developers)), the address says where you are, so you can bookmark or share a view:

| Address | Opens |
| --- | --- |
| `/recordings/<id>` | That recording; add `?t=12:34` for a playback position |
| `?tab=thinking`, `?tab=jev-log` | That right-column tab |
| `?panel=recordings`, `insights`, `speakers`, `labels`, `transcription`, `chat`, `keys` | That window; `?panel=insights&section=fact-checker` or `log` picks a tab, `?panel=chat&chat=chat_N` a chat |

## 26. Before a show

https://hey-tattle.com/docs#show-checklist

### The day before

- Run a short rehearsal session: both meters move, and a line is transcribed.
- Keep a rehearsal as a fallback and give it a clear name (for example "Fallback · Ep 12"). If something fails on air, stop, and **Open** it (free, instant) or **Replay** it (about its original cost).
- Try a new label set on a recording first.

### Pre-show checklist

- Everyone wears headphones; the host wears **earbuds**. On the Mac's speakers, speaker mode drops whatever the host says over a guest.
- In your call app, pick the Mac's built-in microphone: AirPods switch to a low-quality call mode when an app opens their mic.
- Turn on a Focus mode: Tattle records every sound the Mac plays, notifications included.
- Your OpenRouter key has a credit limit.
- The label set is picked and tonight's stories are typed in.
- Rename speakers as they first speak, and merge duplicates.
- Screen-sharing the app to your audience? It is laid out to fit 1280 × 720.
- Tell everyone they are recorded, and get their consent.

### During the show

- Glance at the meters: both should move. A red meter means silence.
- Pause when you want nothing heard or spent; Stop still works.
- At the end, press Stop and wait for it to finish before quitting.

## 27. Troubleshooting

https://hey-tattle.com/docs#troubleshooting

### A meter is red, or reads "silent"

- **The call's meter**: System Audio Recording is off for Tattle (System Settings → Privacy & Security → System Audio Recording), or nothing is playing yet.
- **Your mic's meter**: the microphone permission is off (the launch sheet says so), the wrong microphone is picked, or a USB wireless mic's transmitter is off, muted, or out of range (it sends pure silence).
- Speaker mode shows **muted · call playing** while the call plays: that is expected, not an error.

### "Waiting for speech…" and nothing appears

Check both meters. A call app switching Bluetooth earbuds to their call mode changes the audio setup mid-show; Tattle follows it and restarts the microphone within about 1.5 s, and notes it in Insights → Log. A call app processing your voice can also turn your mic down by about 15 dB.

### Guests appear twice in the transcript

The call is playing through a speaker the mic can hear, and speaker mode did not turn on: most likely a Bluetooth speaker, which Tattle takes for headphones. Use earbuds or headphones.

### Lines read "Not transcribed"

- **OpenAI is out of credit**: OpenAI answers 429 `insufficient_quota` (in Insights → Log). Add credit at platform.openai.com → Settings → Billing.
- **The connection dropped**: Tattle retries every 15 s and once at the end; the audio is kept either way.

### Start live is greyed out

On Apple Speech, the speech model is still downloading (**Getting on-device speech recognition ready… N %**): Start is available as soon as it is. If it says **On-device speech recognition is not ready**, press **Try again**, or switch to OpenAI in cog → **Transcription**.

### Fact-checks, labels, or Chat stop

The header's spend reads **OpenRouter stopped**, or Chat says the credits or the key's limit are exhausted (402): add credit, or raise the key's limit, at openrouter.ai. A model that is rate-limited (429) or whose providers all refuse the privacy setting: pick another model.

### The app did not reopen after an update

That happens once, on the update that renamed Conversation Assistant to Tattle: open **Tattle** from Applications. Your keys and recordings are there.

### An import fails

- "It should end in .tattle": the file is not a recording. (Exports end in `.tattle` rather than `.zip` so that Safari does not unzip them on download.)
- "Exported by a newer Tattle": update the app, then import again.
- "A session is on air": import after the show.

### "The microphone is turned off for Tattle" at every launch

Click **Open System Settings**, turn on Tattle under Microphone, then quit and reopen Tattle.

### A key is refused

Copy it again, whole, into the right field (OpenRouter keys start with `sk-or-`, OpenAI keys with `sk-`). If the service rejects it, check it was not revoked, deleted, or disabled.

Anything else: Insights → Log lists the last 30 errors, and [Help](https://hey-tattle.com/docs#help) says where to ask.

## 28. Limits

https://hey-tattle.com/docs#limits

- Apple Silicon Macs only, macOS 14.2 or later; on-device transcription needs macOS 26.
- English only.
- One session at a time, on one Mac: Tattle opens no network port.
- No video, clip export, social posting, or cloud version.
- No echo cancellation: earbuds are the setup, and speaker mode mutes the mic instead.
- No per-app audio: the call stream is everything the Mac plays.
- No spending limit of its own.
- Your mic is one voice; the call up to 4, or any number.
- Label sets: 2 categories, 2 scores, 8 markers at most. Tonight's stories: 254 at most.
- Imports: 4 GB at most.
- Not on the Mac App Store: its sandbox would get in the way of capturing system audio. It is a signed, notarized direct download.
- Only the latest release is supported.

## 29. Run it from source

https://hey-tattle.com/docs#developers

Tattle is open source. To run it from the code you need Node 24, the Xcode command-line tools, and for on-device transcription the macOS 26 SDK. The permissions then belong to your terminal app, not to Tattle.

```sh
git clone https://github.com/nicolasdao/tattle.git && cd tattle
npm install
npm run models && npm run fixtures
npm run build:capture && npm run build:transcribe
npm run serve            # http://127.0.0.1:4317
```

Keys can also go in a `.env` file (copy `.env.example`); they win over the saved ones.

| Command | Does | Cost |
| --- | --- | --- |
| `npm run serve` | The app in a browser at 127.0.0.1:4317 (`-- --replay <dir> --speed 1\|max` replays a folder) | As a show |
| `npm run app` | The Mac app from the source folder | As a show |
| `npm run replay` | Runs two WAV files through the pipeline into a new session (`--engine apple\|openai`, `--no-factcheck`, `--no-labels`, `--export`) | Free with Apple and both off |
| `npm run preflight` | The pre-show checks: models, capture and permissions, engine, keys, credit, one call of each service, disk space | About $0.01–0.02 |
| `npm run calibrate:speakers` | Speaker counts at thresholds 0.35–0.75, from two WAV files | Free |
| `npm run calibrate:boundary` | Precision and recall of the topic boundary against your labels | Free |
| `npm run capture:test`, `npm run transcribe:test` | Interactive checks of capture and on-device transcription | Free |
| `npm run smoke` | Live checks of every paid service | Up to about $0.30 |
| `npm run dist:mac` | Builds the DMG | Free |
| `npm test`, `npm run test:all` | The test suites, offline | Free |

The full developer documentation is in the [README](https://github.com/nicolasdao/tattle#readme) and the [docs folder](https://github.com/nicolasdao/tattle/tree/master/docs), starting with the architecture.

## 30. Help and licence

https://hey-tattle.com/docs#help

- **Questions and problems**: Help → Tattle on GitHub, or [github.com/nicolasdao/tattle](https://github.com/nicolasdao/tattle). Include your version (Tattle → About Tattle).
- **Security issues**: report them privately, as [SECURITY.md](https://github.com/nicolasdao/tattle/blob/master/SECURITY.md) describes, never in public.
- **Licence**: Tattle is free and open-source software under the [BSD 3-Clause License](https://github.com/nicolasdao/tattle/blob/master/LICENSE), © 2026 Cloudless Consulting Pty Ltd. The components it includes, and their licences, are under Help → Licenses and Acknowledgements and in [THIRD_PARTY_NOTICES.md](https://github.com/nicolasdao/tattle/blob/master/THIRD_PARTY_NOTICES.md).
- **Made by** [Nicolas Dao](https://nicolasdao.com) at [Cloudless Labs](https://cloudlesslabs.com), in Sydney. Follow him on [YouTube](https://www.youtube.com/@nicolasdao) and [X](https://x.com/realnicdao), and watch [MadKoo](https://www.youtube.com/@theMadKoo), the podcast where Tattle was first demoed.

Tattle is an independent project, not affiliated with, sponsored, or endorsed by Apple, OpenAI, OpenRouter, or TypeSafe AI.
