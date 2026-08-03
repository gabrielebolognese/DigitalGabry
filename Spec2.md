# DigitalGabry, specification 2: content surfaces

Extends `SPEC.md`. Everything in `SPEC.md` still applies, in particular section 3 (design system), section 7 (query discipline), and section 13 (invariants). Where the two conflict, `SPEC.md` wins.

This document covers four content surfaces: X, LinkedIn, Instagram, and YouTube. Build these only after Phase 10 of `PLAN.md` is complete and merged.

---

## 1. Shared foundations

### 1.1 One model, four surfaces

The four tabs are views over a single `content_items` table. They differ in which payload fields they use and how they render, not in their storage. Resist the urge to give each platform its own table, because the pipeline, the scheduling link, and the momentum logging are identical across all four.

A content item is distinct from a calendar block. The item is the artifact (a draft, an image, a script). The block is the committed time or the scheduled publish moment. They link: scheduling an item creates a `post` block, and completing that block marks the item posted and logs momentum.

### 1.2 Navigation

The rail gains one item, not four. `Content` (`layout-grid` icon) sits between Calendar and Momentum. Inside the Content view, a segmented sub-navigation in the view header switches platform:

```
┌ view header (38px) ──────────────────────────────────┐
│  Content    [ X ][ LinkedIn ][ Instagram ][ YouTube ] │
│                                    [status] [+ New]   │
└───────────────────────────────────────────────────────┘
```

Sub-nav items are `--fs-micro` uppercase with 6px radius, active at `--bg-selected` and `--text-primary`, inactive at `--text-tertiary`. Each carries its platform brand mark at 14px and a count badge of items in the `idea` or `draft` state.

Four rail items would dilute the rail and break the density rule in `SPEC.md` section 3.6. One rail item with sub-tabs is the correct structure.

The active platform tab persists across app restarts.

### 1.3 Status pipeline

Every content item moves through the same states. Platforms differ only in which states they use.

| Status | Meaning | Used by |
| --- | --- | --- |
| `idea` | Captured, not written | all |
| `draft` | Written, not final | all |
| `ready` | Approved, awaiting publish | all |
| `scheduled` | Linked to a calendar block with a future time | all |
| `posted` | Published, momentum logged | all |
| `archived` | Dead, kept for reference | all |
| `scripted` | Script complete, not filmed | Instagram, YouTube |
| `filmed` | Raw footage exists | Instagram, YouTube |
| `edited` | Cut, awaiting publish | Instagram, YouTube |

Status is shown as a chip: `--fs-micro`, 4px radius, 2px by 6px padding, the category color at 13 percent alpha as background with the color at full saturation as text. `posted` uses `--cat-admin`, `archived` uses `--text-disabled`.

### 1.4 Schema

```sql
CREATE TABLE content_items (
  id           TEXT PRIMARY KEY,
  platform     TEXT NOT NULL,          -- x | linkedin | instagram | youtube
  status       TEXT NOT NULL DEFAULT 'idea',
  title        TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',
  payload      TEXT NOT NULL DEFAULT '{}',
  block_id     TEXT REFERENCES blocks(id),
  project_id   TEXT REFERENCES projects(id),
  posted_utc   INTEGER,
  posted_url   TEXT,
  sort_order   REAL NOT NULL DEFAULT 0,
  created_utc  INTEGER NOT NULL,
  updated_utc  INTEGER NOT NULL,
  deleted_utc  INTEGER,
  hlc          TEXT NOT NULL,
  device_id    TEXT NOT NULL
);
CREATE INDEX idx_content_platform ON content_items(platform, status)
  WHERE deleted_utc IS NULL;
CREATE INDEX idx_content_updated ON content_items(updated_utc)
  WHERE deleted_utc IS NULL;

CREATE TABLE assets (
  id          TEXT PRIMARY KEY,
  path        TEXT NOT NULL,           -- relative to the vault root
  sha256      TEXT NOT NULL,
  mime        TEXT NOT NULL,
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER NOT NULL,
  origin      TEXT NOT NULL DEFAULT 'import',  -- import | generated | capture
  created_utc INTEGER NOT NULL,
  deleted_utc INTEGER,
  hlc TEXT NOT NULL, device_id TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_assets_sha ON assets(sha256) WHERE deleted_utc IS NULL;

CREATE TABLE content_assets (
  content_id TEXT NOT NULL REFERENCES content_items(id),
  asset_id   TEXT NOT NULL REFERENCES assets(id),
  role       TEXT NOT NULL DEFAULT 'primary',  -- primary | variant | reference
  sort_order REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (content_id, asset_id, role)
);

CREATE VIRTUAL TABLE content_fts USING fts5(
  title, body, content='content_items', content_rowid='rowid'
);
```

`content_items` is added to the FTS search and to the `Ctrl+K` palette alongside blocks.

### 1.5 Asset vault

All images live on disk under the vault root, defaulting to `{appDataDir}/vault/`:

```
vault/
  assets/
    x/          {sha256[0:2]}/{sha256}.png
    linkedin/
    instagram/
    reference/
  outbox/       staging folder for the "post this" flow
```

Content addressing by sha256 means importing the same image twice is a no-op, and moving the vault only requires updating one setting. Never store images as blobs in SQLite. Never store an absolute path in the database, only a path relative to the vault root.

Importing an image: hash it, copy it into the vault, read its dimensions, insert an `assets` row, link it. Deduplicate on the hash.

### 1.6 Card grid, shared

All four tabs use the same grid shell:

- CSS grid, `repeat(auto-fill, minmax(260px, 1fr))`, 12px gap, 16px view padding.
- Card: `--bg-surface`, 1px `--border-hair`, 8px radius, hover to `--border`, selected to `--accent-border`. No shadow.
- Card header row: platform mark at 14px, status chip, spacer, an overflow `more-horizontal` button.
- Card footer row: `--fs-micro`, `--text-tertiary`, showing relative updated time and any scheduled date.
- Virtualized above 100 cards. Below that, plain rendering.
- Sort options: updated, created, scheduled date, status. Persisted per platform.
- Filter bar: status multi-select, project, tag, and a text query hitting `content_fts`.
- Empty state: one line at `--fs-meta` and `--text-tertiary` plus the new-item action. No illustration.

---

## 2. X posts

### 2.1 Payload

```ts
type XPayload = {
  charLimit: number;        // soft limit, default 150
  threadParentId?: string;  // for future thread support, unused in v1
  altText?: string;
};
```

### 2.2 Card

Fixed layout, image-forward:

```
┌──────────────────────────────┐
│ [X]  draft            [ ··· ]│
│ ┌──────────────────────────┐ │
│ │        image 16:9        │ │
│ └──────────────────────────┘ │
│ Post text, up to three lines │
│ wrapping, ellipsis after.    │
│                              │
│ 128/150      [copy] [Post this]│
└──────────────────────────────┘
```

- Image area: 16:9, `object-fit: cover`, 4px radius, `--bg-elevated` when absent with a centered 14px `image-plus` icon acting as the picker.
- Text: `--fs-meta`, `--text-primary`, three lines maximum with ellipsis.
- Character counter: `--fs-micro`. `--text-tertiary` under 80 percent of the limit, `--cat-deadline` from 80 to 100 percent, `--cat-build` above it. The 150 limit is soft and editable in Settings. A hard block applies at 280, the platform maximum.
- Both buttons are icon plus label at `--fs-micro`, 6px radius.

### 2.3 Editor

Click a card to open the inspector overlay (same 320px component as blocks, `--bg-elevated`):

- Textarea with the live counter and inline hard-limit enforcement.
- Image slot with drag-and-drop, paste from clipboard, and a file picker.
- Alt text field.
- Status select, project select, tags.
- Schedule control creating a linked `post` block.
- Posted URL field, filled after posting.

Paste from clipboard is the important one. Copying an image from anywhere and pressing `Ctrl+V` in the editor imports it into the vault directly.

### 2.4 The "post this" flow

This is the feature's entire reason for existing, so it needs to be exactly right.

On click, in order:

1. Copy the post text to the clipboard via `@tauri-apps/plugin-clipboard-manager`.
2. Copy the image file into `vault/outbox/` with a readable filename: `{YYYY-MM-DD}-{slug}.png`. Clear the outbox of files older than 24 hours on each run.
3. Reveal that file in the OS file manager via `revealItemInDir` from `@tauri-apps/plugin-opener`, so the file is selected and ready to drag.
4. Open `https://x.com/compose/post` in the default browser.
5. Show a toast: "Text copied, image ready in outbox", with a "Copy image instead" action.

The toast action writes the image itself to the clipboard via `writeImage`, for the case where he would rather paste than drag. Both paths must exist, because the clipboard cannot usefully serve text and an image to the same paste.

Prefer this over a download dialog. The image already exists on disk, so re-downloading it is a step backwards. A save dialog is available as a secondary action in the overflow menu for the rare case where he wants a copy elsewhere.

The outbox folder path is configurable in Settings, defaulting to `{vault}/outbox`. Offer a preset pointing at the OS Pictures folder for convenience.

**Do not attempt to post via the X API in v1.** The write endpoints are paid, rate limited, and the auth flow adds meaningful complexity for a feature that saves one drag.

### 2.5 Marking posted

A "Mark posted" action in the overflow menu, and an automatic prompt in the toast 60 seconds after "Post this" fires. Marking posted sets `status = 'posted'`, stamps `posted_utc`, optionally captures the URL, and inserts an `activity_log` row for the X post activity type with `source = 'block'`, which flows straight into momentum.

---

## 3. LinkedIn posts

### 3.1 Architecture decision: structured JSON, not HTML

The model returns a typed object, and local React templates render it to pixels. Reasons this is the right split:

- **Consistency.** Brand tokens live in your code, so every image is exactly on brand. A model regenerating layout each call drifts.
- **Editability.** After generation you can fix a headline without regenerating the whole image.
- **Reliability.** A schema either validates or it does not. Freeform HTML fails silently at render time, and you find out by looking at a broken image.
- **Cost.** Three layout variants come from one call, because the same JSON renders through three templates.
- **Debuggability.** You can diff two generations.

A freeform HTML mode remains available as an escape hatch, rendered in the same sandboxed iframe.

### 3.2 Generation pipeline

```
post text
   ↓  Anthropic API, system prompt from prompts/linkedin-image.md
structured JSON (validated with zod)
   ↓  React template, offscreen iframe at exactly 1080x1350
DOM
   ↓  modern-screenshot domToPng, pixelRatio 1
PNG
   ↓  hash, write into vault/assets/linkedin/, insert asset row
linked to the content item as role='variant'
```

Details that matter:

- **Model:** `claude-sonnet-4-6`. The task is structured extraction, not deep reasoning.
- **Prompt caching:** the system prompt is long and reused on every call, so send it as a system block with `cache_control: { type: "ephemeral" }`. This cuts cost substantially across a batch.
- **Prompt storage:** `{appDataDir}/prompts/linkedin-image.md`, seeded on first run from a bundled default, editable in a Settings text editor. Never bake it into the build, because iterating on it should not require a rebuild.
- **Output contract:** instruct the model to return only JSON, with no prose and no markdown fences. Strip fences defensively before parsing anyway, then validate with zod. On a validation failure, retry once with the error message appended, then surface the raw output for manual repair rather than failing silently.
- **Fonts:** the iframe must load the local Geist woff2 files and `document.fonts.ready` must resolve before rasterizing, otherwise the capture renders in a fallback face.
- **Determinism:** store the exact JSON, the prompt hash, and the template id in `payload` alongside the asset, so any image can be reproduced or re-rendered through a different template later.

### 3.3 Content schema

```ts
type LinkedInPayload = {
  format: 'feature-spotlight' | 'contrarian' | 'build-log' | 'numbers' | 'problem-first';
  imageSpec?: LinkedInImageSpec;
  templateId?: string;
  promptHash?: string;
  generatedAt?: number;
};

type LinkedInImageSpec = {
  eyebrow?: string;        // <= 24 chars, uppercase label
  headline: string;        // <= 60 chars
  subheadline?: string;    // <= 90 chars
  bullets?: string[];      // 0 to 4 items, <= 48 chars each
  codeSnippet?: {
    language: string;
    lines: string[];       // <= 8 lines, <= 52 chars each
  };
  metric?: {
    value: string;         // e.g. "18ms"
    label: string;         // <= 30 chars
  };
  badge?: string;          // <= 16 chars
  accent: 'amber' | 'orange' | 'neutral';
  layout: 'headline' | 'headline-bullets' | 'code' | 'metric' | 'split';
};
```

The five post formats match the five repeatable LinkedIn formats already in use, so the format select biases the generation toward the right layout.

Every string field carries a hard character limit, enforced in the zod schema. This is what prevents the single most common failure mode, which is a headline that overflows its box. If the model exceeds a limit, the retry message says exactly which field and by how much.

### 3.4 Templates

Five React components in `src/views/content/linkedin/templates/`, each a pure function of `LinkedInImageSpec`, each rendering at exactly 1080×1350:

| Layout | Structure |
| --- | --- |
| `headline` | Eyebrow, large headline, subheadline, brand mark bottom left |
| `headline-bullets` | Eyebrow, headline, up to 4 bullets with hairline separators |
| `code` | Headline, then a monospace code block with a window chrome bar |
| `metric` | Oversized metric value, label beneath, headline above |
| `split` | Headline left at 55 percent, code or bullets right |

All five use the FlashFX brand tokens (dark navy `#14171F`, amber to orange `#FFB800` to `#FF6200`), which are declared in a separate `brand.css` file and are the **only** place in the application where the FlashFX palette appears. The app's own interface stays on the DigitalGabry tokens from `SPEC.md` section 3.1. These two systems must never mix.

### 3.5 Card and editor

Card layout matches the X card, with a 4:5 image area instead of 16:9 and a `--fs-micro` format label in the header.

The editor adds a generation strip beneath the body textarea:

```
[ format select ]  [ Generate image ]        [ regenerate ] [ edit spec ]
```

- **Generate image** runs the pipeline and produces three variants (three templates fed the same spec), shown as a horizontal picker of thumbnails. Clicking one promotes it to `role='primary'`.
- **Edit spec** opens the validated JSON in a field-by-field form, not a raw editor, with the same character limits enforced live. Editing any field re-renders the preview instantly, with no API call.
- **Regenerate** re-runs the API call with an optional nudge field ("more technical", "lead with the number").
- Generation state is visible: a `--bg-surface` skeleton at the right aspect ratio, never a spinner.
- If no API key is configured, the strip shows an inline line pointing at Settings, and the rest of the editor works normally.

Export uses the same "post this" flow as X, targeting `https://www.linkedin.com/feed/`.

---

## 4. Instagram video manager

### 4.1 Payload

```ts
type InstagramPayload = {
  format: 'reel' | 'carousel' | 'story';
  idea: string;                 // the one-line premise
  references: Reference[];
  script: ScriptSection[];
  hookVariants?: string[];      // up to 3 alternate openings
  audioNote?: string;
  estimatedSeconds?: number;    // derived, not stored as truth
};

type Reference = {
  id: string;
  url: string;
  note: string;
  assetId?: string;             // optional local thumbnail or screenshot
  addedUtc: number;
};

type ScriptSection = {
  id: string;
  kind: 'hook' | 'context' | 'body' | 'payoff' | 'cta';
  text: string;
  bRoll?: string;               // what is on screen during this line
  seconds?: number;             // manual override of the estimate
};
```

### 4.2 Card

```
┌──────────────────────────────┐
│ [IG]  scripted        [ ··· ]│
│ Idea line, two lines maximum │
│                              │
│ ▸ 4 sections  ·  0:38        │
│ ▸ 3 references               │
│ ──────────────────────────── │
│ updated 2h ago               │
└──────────────────────────────┘
```

No image on the card by default, because these are pre-production artifacts and the idea is the identifying content. If a reference thumbnail exists, show it as a 32px square in the header.

### 4.3 Editor

Full-width editor, not the 320px inspector overlay. Video scripts need horizontal space, so clicking a card opens a dedicated editing surface within the Content view, with a back control in the header. Three columns:

**Left, 220px: idea and metadata.** Idea textarea, format select, status, project, tags, audio note, hook variants list, schedule control.

**Center, fluid: the script.** An ordered list of sections. Each section is a row with:
- a `--fs-micro` uppercase kind label in a 72px gutter, color-coded by kind using the five category colors
- the line text in an auto-growing textarea at `--fs-body`
- a b-roll field beneath at `--fs-micro` and `--text-secondary`, placeholder "what is on screen"
- a duration estimate at the right, `--fs-micro`, tabular

Sections are reorderable by drag using the same interaction as calendar blocks. `Enter` at the end of a section creates the next one. `Tab` cycles the kind.

Duration is estimated at 2.6 words per second, which is the realistic rate for scripted short-form delivery, and can be overridden per section. The header shows the running total, turning `--cat-deadline` above 90 seconds and `--cat-build` above 180.

**Right, 260px: references.** A vertical list of reference cards, each with an optional thumbnail, the URL as a clickable link opening in the browser, and a note field. Add by pasting a URL, which triggers an optional metadata fetch (title and thumbnail) with a clear failure state, since Instagram blocks most scraping. Manual paste of a screenshot is the reliable path and must work by `Ctrl+V` anywhere in the column.

### 4.4 Export

Instagram has no useful web composer, so the flow differs from X and LinkedIn. "Send to phone" performs:

1. Write the full script to `vault/outbox/{date}-{slug}.txt`, formatted for reading while filming: kind labels, one line per section, b-roll in brackets.
2. Copy the script to the clipboard.
3. Reveal the outbox folder.

Whether that file reaches the phone by cloud folder, cable, or messaging is deliberately outside the app's scope.

---

## 5. YouTube planner

**Build the shell only.** Specification deliberately deferred.

Scope for this phase:

1. The `youtube` sub-tab, present and selectable, using the YouTube brand mark.
2. The shared card grid, filters, sort, and search, wired to `content_items` with `platform = 'youtube'`.
3. A card showing title, status chip, and updated time. Nothing else.
4. A "New video" action creating an item with `status = 'idea'` and an empty payload.
5. An editor with a title field, a body textarea, status, project, tags, and the schedule control. No platform-specific fields at all.
6. `type YouTubePayload = Record<string, never>` with a comment noting it is intentionally unspecified.
7. An empty state reading: "Video planning is not set up yet."

Do not invent chapter fields, thumbnail generators, SEO helpers, or retention planning. Adding speculative structure now guarantees rework, because the eventual specification will not match the guess.

---

## 6. Momentum integration

Marking any content item posted inserts an `activity_log` row with `source = 'block'` and the item id in `note`, using this mapping:

| Platform and format | Activity type |
| --- | --- |
| x | X post |
| linkedin | LinkedIn post |
| instagram, reel | Instagram reel |
| instagram, story | Instagram story |
| youtube | resolved when the YouTube spec lands, defaulting to YouTube long form |

Reverting an item out of `posted` soft-deletes the corresponding activity row, so the momentum curve stays honest.

The Momentum view's quick log strip gains no new entries from this, because auto-logging already covers it. Double logging is the failure mode to guard against, so the auto-logged row must be visible and marked in any activity list.

---

## 7. Build phases

Append these to `PLAN.md`. Same loop: one branch, one session, `/clear` between phases.

### Phase 11, content foundations

```
Read SPEC.md and Spec2.md sections 1 and 6.

Implement Phase 11 only: shared content infrastructure. No platform
specific UI.

Build:
1. Migration 002: content_items, assets, content_assets, content_fts and
   its sync triggers, per Spec2.md section 1.4.
2. Repository functions for content items and assets, following the same
   patterns as blocks: range and filter bounded reads, deleted_utc
   filtering, ops logging on every mutation.
3. src/vault/vault.ts: the asset vault per section 1.5. importAsset(file)
   hashes with sha256, deduplicates, copies into the platform folder,
   reads dimensions, inserts the row. Plus resolveAssetPath and a
   revealInOutbox helper.
4. src/views/content/ContentView.tsx: the rail item, the segmented
   platform sub-nav with count badges, persisted active tab.
5. src/views/content/ContentGrid.tsx: the shared card grid, filter bar,
   sort control, search against content_fts, empty state, and
   virtualization above 100 items, per section 1.6.
6. src/components/StatusChip.tsx per section 1.3.
7. Add content items to the Ctrl+K palette results.
8. src/content/linkToBlock.ts: scheduling an item creates a linked post
   block; completing that block marks the item posted and logs the
   momentum activity per section 6; reverting soft-deletes that row.

Do NOT build: any platform specific card, editor, or generation.

Acceptance criteria:
- Importing the same image twice creates exactly one assets row.
- The grid renders 500 seeded items without dropping frames.
- Search returns results from both blocks and content items.
- Scheduling and completing an item produces exactly one activity_log row,
  and reverting removes it.
```

### Phase 12, X posts

```
Read Spec2.md section 2.

Implement Phase 12 only: the X tab.

Build:
1. XCard per section 2.2, including the 16:9 image area, three-line text
   clamp, and the color-staged character counter.
2. The inspector editor per section 2.3, with drag-and-drop, clipboard
   paste, and file picker image import through the vault.
3. The "post this" flow per section 2.4, in the exact order specified:
   copy text, stage to outbox with a readable filename, reveal in the
   file manager, open the composer, toast with a "Copy image instead"
   action that writes the image to the clipboard.
4. Outbox cleanup of files older than 24 hours on each run.
5. Mark posted, manually and via the delayed toast prompt, wired to the
   momentum logging from Phase 11.
6. Settings: outbox folder picker with an OS Pictures preset, and the
   soft character limit, default 150.

Acceptance criteria:
- Pasting an image with Ctrl+V in the editor imports it to the vault.
- "Post this" completes all five steps with a single click.
- The hard 280 limit cannot be exceeded; the soft limit only changes the
  counter color.
- Marking posted logs exactly one X post activity.
```

### Phase 13, LinkedIn generation pipeline

Use plan mode. Build the pipeline and validate it before any template polish.

```
Read Spec2.md section 3 in full.

Implement Phase 13 only: LinkedIn posts and image generation.

Build in this order.

A. src/content/linkedin/schema.ts: the zod schema for LinkedInImageSpec
   per section 3.3, with every character limit enforced.

B. src/content/linkedin/generate.ts: the API call. Model
   claude-sonnet-4-6. System prompt loaded from
   {appDataDir}/prompts/linkedin-image.md, seeded on first run from a
   bundled default, sent as a system block with
   cache_control: { type: "ephemeral" }. Strip markdown fences
   defensively, parse, validate with zod. On validation failure retry
   once with the specific field errors appended to the message, then
   surface the raw output for manual repair. Never fail silently.

C. src/content/linkedin/render.ts: rasterization. Mount the template in
   an offscreen iframe sized exactly 1080x1350, load the local Geist
   woff2 files inside it, await document.fonts.ready, then capture with
   modern-screenshot domToPng at pixelRatio 1. Hash and write into
   vault/assets/linkedin/, insert the asset row, link with role='variant'.

D. Five templates in src/views/content/linkedin/templates/ per section
   3.4, each a pure function of LinkedInImageSpec rendering at exactly
   1080x1350. FlashFX brand tokens live in a separate brand.css used ONLY
   by these templates. The DigitalGabry tokens from SPEC.md must never
   appear in a template, and brand.css must never appear in the app UI.

E. LinkedInCard with a 4:5 image area and the format label.

F. The editor generation strip per section 3.5: format select, generate
   producing three variants as a thumbnail picker, promote to primary,
   field-by-field spec editor with live preview and no API call,
   regenerate with an optional nudge, skeleton loading state, and a
   no-key inline state pointing at Settings.

G. Settings: a text editor for the system prompt file, with reset to
   default.

H. Export via the same flow as X, targeting the LinkedIn feed.

Acceptance criteria:
- A generated PNG is exactly 1080x1350 pixels.
- Fonts render correctly in the capture, never a fallback face.
- A deliberately malformed model response is caught, retried once, then
  surfaced for repair without a crash.
- Editing a spec field re-renders the preview with no network call.
- The generation payload stores the JSON, prompt hash, and template id,
  so the same image can be reproduced.
- No FlashFX brand color appears anywhere outside the templates folder.
```

### Phase 14, Instagram video manager

```
Read Spec2.md section 4.

Implement Phase 14 only: the Instagram tab.

Build:
1. InstagramCard per section 4.2.
2. The three-column full-width editor per section 4.3, replacing the
   inspector overlay for this platform only, with a back control.
3. Script sections: kind gutter with color coding, auto-growing text,
   b-roll field, per-section duration, drag reordering reusing the block
   drag interaction, Enter to create the next section, Tab to cycle kind.
4. Duration estimation at 2.6 words per second with per-section override
   and a running total that changes color at 90 and 180 seconds.
5. References column: paste a URL to add, optional metadata fetch with a
   clear and non-blocking failure state, Ctrl+V anywhere in the column to
   attach a screenshot, click to open in the browser.
6. Hook variants list, up to three, with a promote action swapping a
   variant into the hook section.
7. "Send to phone" per section 4.4.

Acceptance criteria:
- A 12 section script stays responsive while typing.
- Reordering sections preserves per-section duration overrides.
- A failed reference metadata fetch still adds the reference with the URL
  and note intact.
- The duration total matches the sum of sections exactly, including
  overrides.
```

### Phase 15, YouTube shell

```
Read Spec2.md section 5.

Implement Phase 15 only: the YouTube tab shell. This phase is
deliberately minimal. Implement exactly the seven items listed in
Spec2.md section 5 and nothing more.

Do NOT add chapters, thumbnail generation, SEO fields, retention
planning, description templates, or any other YouTube specific
structure. The specification for this surface is deferred, and inventing
structure now guarantees rework.

Acceptance criteria:
- The tab is selectable and lists items with platform = 'youtube'.
- Creating, editing, scheduling, and searching work through the shared
  components with zero YouTube specific code paths.
- YouTubePayload is an empty type with the explanatory comment.
```

---

## 8. Invariants, added

Extending `SPEC.md` section 13. The originals all still hold.

15. Images are never stored in SQLite. They live in the vault, addressed by sha256, referenced by a path relative to the vault root. Absolute paths are never persisted.
16. The FlashFX brand palette exists only inside `src/views/content/linkedin/templates/` via `brand.css`. The DigitalGabry token system never appears inside a template, and the brand palette never appears in the application interface.
17. Every model response is validated against a schema before use. A parse or validation failure is surfaced to the user with the raw output, never swallowed and never silently defaulted.
18. Generated assets store the inputs that produced them (spec JSON, prompt hash, template id), so any image is reproducible.
19. Content items and calendar blocks link, they do not duplicate. Publish state lives on the item, committed time lives on the block.
20. Momentum is logged exactly once per publication. Auto-logged rows are visibly marked so they cannot be manually double counted.
