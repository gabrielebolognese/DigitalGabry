# DigitalGabry, a guide

A local-first desktop calendar and momentum tracker. Everything lives in a SQLite
file on your machine. The app works fully offline, and every feature except the
assistant panel works with no API key configured.

---

## The shell

Three views, reached from the rail on the left:

| View | What it is |
| --- | --- |
| **Calendar** | A week grid. Where you plan and where you work. |
| **Momentum** | Your score over time, what fed it, and a way to log activity. |
| **Settings** | API key, backups, activity types, and the momentum constants. |

The assistant panel sits on the right. Drag the divider to resize it, or press
`Tab` to it and use the arrow keys.

---

## Calendar

### With the mouse

- **Drag on empty space** to create a block.
- **Click** a block to select it and open the inspector.
- **Double-click** a block to rename it inline.
- **Drag** a block to move it, or drag its top or bottom edge to resize it.
- **Ctrl + scroll** to zoom the hour height in and out.

The header has the month, a **Today** button, and arrows for the previous and
next week.

### With the keyboard

These work whenever you are not typing in a field.

| Key | Does |
| --- | --- |
| `T` | Jump to today |
| `←` `→` | Previous and next week, when nothing is selected |
| `←` `→` `↑` `↓` | Move the selection, when a block is selected |
| `Enter` | Toggle the selected block between open and done |
| `Delete` | Delete the selected block, with an undo toast |
| `Escape` | Cancel a rename, or close the inspector |
| `Tab` | Focus the week grid |

### Blocks

Every block has a **kind**, which sets its icon:

`task`, `post`, `event`, `focus`, `deadline`, `note`

and a **category**, which sets its colour tint:

`build`, `content`, `admin`, `personal`, `deadline`

A `post` can also carry a platform (`x`, `linkedin`, `youtube`, `instagram`,
`tiktok`, `github`, `blog`), which replaces the kind icon with the platform mark.

Blocks move through `open`, `in progress`, `done`, `cancelled`.

### Repeating blocks

Select a block and fill in the **Recurrence** field in the inspector. It takes an
iCalendar rule as text, not a picker yet, so you write it out:

| Rule | Means |
| --- | --- |
| `FREQ=DAILY` | every day |
| `FREQ=WEEKLY;BYDAY=MO,WE,FR` | Monday, Wednesday, Friday |
| `FREQ=WEEKLY;INTERVAL=2` | every other week |
| `FREQ=MONTHLY;BYMONTHDAY=1` | the first of the month |
| `FREQ=DAILY;COUNT=10` | ten times, then stop |

Clear the field to make the block a one-off again. Instances are generated across
a rolling 18-month window, so a daily rule stays correct as you scroll. Hourly
and minutely rules are refused on purpose.

When you edit or delete one instance, the app asks what you meant:

- **This occurrence** — writes a single exception, the rest of the series is untouched.
- **This and future** — splits the series in two at that point.
- **Whole series** — changes the rule itself.

Changing a series' time or rule resets any modified occurrences, and the app
tells you how many before it does it.

---

## Quick capture

Press **`Ctrl + Shift + Space`** from anywhere, even with the app unfocused. A
small window opens, already focused. Type one line and press `Enter`. `Escape`
hides it.

The line is parsed as you type, and a preview underneath shows what it
understood:

| You type | It means |
| --- | --- |
| `#deep` | a tag |
| `@website` | a project |
| `!high` | priority, one of `!low` `!normal` `!high` |
| `focus`, `post`, `note`… | a leading kind keyword |
| `youtube`, `github`… | a platform, which also makes it a post |
| `today`, `tomorrow`, `friday` | a day |
| `14:30`, `9am`, `7pm` | a time |

Everything left over becomes the title. With no time given, a captured block
lands at 09:00 for 30 minutes.

Captured blocks appear in the calendar immediately, without a refresh.

---

## Command palette

Press **`Ctrl + K`**.

One box searches three things at once: your **blocks** by title, the **views**,
and the **actions** below. Arrow keys move, `Enter` runs, `Escape` dismisses.

| Action | Shortcut, if it has one |
| --- | --- |
| Go to calendar, momentum, settings | — |
| Go to today | `T` |
| Toggle assistant panel | `Ctrl .` |
| Undo last change | — |
| Redo last change | — |
| Back up now | — |
| Export now | — |

Choosing a block takes the calendar to its week and selects it. Blocks with no
date are left out, since there is nowhere yet to show them.

Undo and redo walk the change log in the database, not a list held in memory, so
they still work after a restart.

---

## Assistant panel

`Ctrl + .` shows and hides it. It opens on a **summary** of your week. Ask a
question and it becomes a **chat**; the arrow at the top left goes back.

This is the one feature that needs an Anthropic API key. Add it in Settings.
Without one the panel shows an empty state and nothing else in the app changes.
Your calendar is sent as context only when you ask it something.

---

## Momentum

The header shows your current **score**, its **level**, the change over the last
week, and your **streak**.

Levels: **Dormant** → **Warming** (25) → **Steady** (75) → **Building** (200) →
**Compounding** (450) → **Peak** (900).

Below that:

- A **chart** over the last 30, 90, or 365 days.
- A **breakdown** of what fed the score, by activity type.
- A **heatmap** of daily activity.
- A **quick log** bar along the bottom. One click logs one of an activity type.

Completing blocks feeds momentum, and so does logging activity directly. The
score decays a little each day, so it reflects recent work rather than a lifetime
total. The raw activity log is the truth; the score is only ever a cache computed
from it, which is why changing the constants can rebuild the whole curve.

---

## Settings

**Anthropic API key.** Stored in your OS application data folder, shown masked
once saved, never written to a log or a committed file.

**Backups and export.** Pick the folders, set how many snapshots to keep, and run
either on demand. Each shows when it last ran.

**Import a file.** Takes a Markdown or CSV file of blocks. A bad row is reported
and skipped; the good rows still import, and nothing already in the app is
touched. Import is one-directional and is not sync.

**Activity types.** What appears in the quick log bar, and what each one is worth.

**Momentum constants.** Decay, streak increment, streak cap, streak threshold.
Changing any of them rewrites the whole curve from the activity log, so the app
asks you to save and recompute rather than applying as you type.

---

## Backups and export

Both run nightly after 03:00 local time, and both can be run on demand.

**Backups** copy the database to a dated snapshot in your backup folder, keeping
the most recent 30. The check is against the date, not a timer, so a machine
asleep at 3am catches up when it wakes and one left running for a week does not
miss a night.

**Export** writes one Markdown file per month, plus `projects.json`,
`activity.json` and `momentum.json`. Ordering is stable, so re-running it with
nothing changed produces byte-identical files and an empty diff. If the export
folder is a git repository, the app stages and commits with the date as the
message. If it is not, it quietly skips that step.

The export is for reading and for keeping. It is never read back as a source of
truth.

---

## Window and tray

Closing the window hides it to the tray rather than quitting, so the global
capture shortcut keeps working. The tray menu has **Open**, **Quick capture** and
**Quit**. Use Quit when you actually want it gone.

---

## Good to know

- **It is all local.** No account, no sync, no telemetry. The database is a file.
- **Do not put the live database in a cloud-synced folder.** That corrupts SQLite
  write-ahead logs. Point your *backup* folder at cloud storage instead, which is
  what it is for.
- **Nothing is hard deleted.** Deleted blocks are marked and filtered out, which
  is what makes undo reliable.
- **Reduced motion is respected.** If your system asks for it, transitions are off.
