# PLAYHEAD — DESIGN.md

The visual and interaction language of the PLAYHEAD shell. This document
describes what is actually implemented, not an aspiration. If the code and this
document disagree, the code is right and this file is a bug.

---

## 1. Creative north star

**A music-analysis operating system found inside a forgotten signal lab.**

The player does not visit a website. They **boot PLAYHEAD**. The world outside is
Cosmic Pixel Brutalism — huge, spatial, surreal. The shell that wraps it is the
opposite: precise, flat, operational. That contrast is the identity.

The mental test for every screen:

> If the PLAYHEAD logo disappeared, would this still be recognisably PLAYHEAD?

If a screen could belong to any dark dashboard, it is not finished.

### What this is not

Not a cyberpunk UI kit. Not Kali cosplay. Not a Matrix terminal. Not a SaaS
dashboard wearing terminal clothes. No fake hexadecimal, no invented telemetry,
no decorative "MEMORY SECTOR A7F1" theatre. Every visible number is real state
the player can act on.

---

## 2. Composition

### The shell

```
┌ system strip        mark · SIGNAL OS · 14 SIGNALS · 00 RECOVERED · DROPS 00
├ workspace nav       01 SIGNAL PACK signal.list │ 02 CUSTOM AUDIO signal.inject │ …
├ workspace           the active surface
└ status rail         CLIENT-SIDE DSP · PROCEDURAL ROUTE · [ONLINE] identity
```

The shell is **top-aligned and left-weighted**. There is no centered hero, no
logo floating above a tagline, no symmetrical card grid. It fills the viewport
(`min-height: calc(100vh - 56px)`) and the status rail sits at the bottom,
because that is what software does.

### Rules over boxes

Regions are separated by **1px hairlines and alignment**, not by containers. A
box appears only where a real surface boundary exists — the injection drop zone,
a text input, a select. Nested panels are treated as a defect.

### Deliberate asymmetry

The Signal Pack is a `1fr / 400px` split: a dense registry on the left, a calm
fixed instrument panel on the right. The two halves are intentionally different
weights. Equal-weight columns are the tell of a generated dashboard.

### Density hierarchy

Three densities coexist and are not averaged out:

- **dense data** — registry rows, ~30px tall, one signal per line
- **comfortable controls** — command buttons at 9–11px padding, real targets
- **large signal object** — the selected-signal title and the trace rail

---

## 3. Terminal grammar

PLAYHEAD has its own command vocabulary. It is **not** decorative: every verb
maps to the action the surface actually performs, and nothing else is written in
command form.

| Workspace | Verb | Real action |
|---|---|---|
| Signal Pack | `signal.list` | enumerate the Signal Pack |
| Custom Audio | `signal.inject` | load external audio |
| Movement Lab | `lab.configure` | configure the sandbox |
| Armory | `armory.open` | open the loadout inventory |
| Online | `net.session` | race / leaderboard session |

Command rail verbs on the Signal Pack: `signal.exec`, `audition`, `ghost.load`.
The compile screen's launch verb is `map.exec`.

Prompts render as `ph://signal$` with a blinking caret. The caret is the only
blinking element in the shell.

---

## 4. Colour

Colour is a **role**, never decoration. Most of the shell is cold off-white on
near-black; colour appears only when a state means something.

| Role | Token | Use |
|---|---|---|
| Surface | `--bg-void` `--bg-primary` `--bg-raised` `--bg-inset` | near-black, cold navy cast |
| Rule | `--rule` `--rule-strong` `--rule-faint` | hairlines |
| Text | `--text-primary` `--text-secondary` `--text-muted` `--text-dim` | cold off-white → steel → dim |
| Signal | `--signal` `#4de3ff` | selection, active cursor, primary action |
| Verified | `--verified` `#9bf24d` | success, drop available |
| Warning | `--warning` `#ffb347` | caution, banked |
| Error | `--error` `#ff3b5c` | signal lost, failure |
| Artifact | `--artifact` `#c77dff` | abnormal / artifact states only |

### Song contamination

The selected track's palette does **not** repaint the shell. It contaminates
specific elements only: the registry cursor, the rank value, the signal trace,
and the adaptive viewmodel accent. The OS stays PLAYHEAD; the signal temporarily
touches it. That distinction is load-bearing.

---

## 5. Type

Two families, self-hosted from `public/assets/fonts/` (no third-party CDN — a
blocked font host would silently degrade the whole shell to system sans).

- **Display** — `Archivo` (500/700/800). Industrial grotesque. Used for the
  workspace title, the selected-signal title, and the product mark only.
- **System / data** — `IBM Plex Mono` (400/600/700). A true workhorse terminal
  mono with tabular figures. Everything else.

### Scale

| Token | Size | Role |
|---|---|---|
| `--type-workspace` | 28px | workspace title |
| `--type-signal` | 22px | selected signal title |
| `--type-command` | 14px | primary command text |
| `--type-body` | 13px | descriptions, system output |
| `--type-data` | 12.5px | tabular data, registry rows |
| `--type-micro` | 11px | column headers, status flags. **FLOOR.** |

**Nothing renders below 11px.** The floor is a rule, not a hint: "terminal" must
not be synonymous with "tiny". Verified at runtime — the minimum computed
font-size in the shell is 11px at every tested viewport. (The DEV calibrator and
DEV overlay sit at 10px; they are developer tools, not player UI.)

### Case and tracking

Tracked ALL-CAPS is reserved for **column headers, system codes and status
flags** — `SIGNAL`, `BPM`, `LEN`, `RANK`, `DSP`, `FILE`, `VAL`. Everything else
is normal case: track names, descriptions, commands, values. A screen where every
label is `S P A C E D   C A P S` is a defect.

---

## 6. Shape and motion

### Shape

- Radii: `0` (default), `2px` (inputs/buttons), `3px`. Nothing rounded beyond 3px.
- 1px rules everywhere. No thick accent bars — a 3–4px coloured left border is
  the single most recognisable generated-UI tell and is banned.
- No pills except where a compact tag genuinely benefits.
- No glass, no blur panels, no drop-shadow bloom.

### Motion

Fast and precise, matching PLAYHEAD movement.

| Token | Duration | Use |
|---|---|---|
| `--motion-instant` | 60ms | selection, hover state |
| `--motion-fast` | 110ms | control state |
| `--motion-normal` | 190ms | panel state |
| `--motion-slow` | 320ms | rare transitions |

Easing is `cubic-bezier(0.16, 1, 0.3, 1)` — sharp out, no bounce. All durations
collapse to 1ms under `prefers-reduced-motion`.

**Banned:** springy cards, `translateY(-2px)` hover lifts, `scale(1.03)`, entrance
stagger where every element fades up from `y: 20px`, glow-on-hover.

### Interaction grammar

| State | Treatment |
|---|---|
| rest | flat, hairline rule, secondary text |
| hover | **inverse block** — foreground/background swap |
| focus | 2px signal outline at 2px offset (never removed) |
| selected row | inverse block + `>` cursor on the row number |
| active workspace | brightened text + signal underline, no fill |

Layout is never animated. `width`/`height` transitions are replaced with
`transform: scaleX/scaleY` (HUD progress bar, analysis waveform).

---

## 7. Surfaces

### Signal Pack — registry + inspector

Left: a dense registry. One line per signal, fixed columns
(`# / SIGNAL / BPM / LEN / RANK`), tabular numerals, right-aligned numerics, `—`
for no record. Selection is an inverse block with a `>` cursor.

Right: the selected-signal inspector — title, spec rows, personal records,
description, and the **signal trace** (a deterministic 18-bar fingerprint derived
from catalog metadata, not an audio waveform).

Below: the command rail — `ph://signal$`, `signal.exec`, `audition`, `ghost.load`.

The registry scrolls internally so a long catalog never becomes a scrolling page.

### Custom Audio — signal injection

A waiting input channel, not an upload card. `awaiting external audio stream`,
the accepted formats, a `browse` action, and beside it the **real pipeline**
(FILE / DSP / MAP / SURF / VAL / VIS) that actually runs. No fake delays; the
stages correspond to real work.

### Movement Lab — process launch

A configuration surface: soundtrack select (dark, readable, keyboard-native),
what the sandbox practises, and one `lab.exec` command. Not a card page.

### Armory — artifact registry

Loadout header, compact decoder line, slot tabs, filters, and a dense tile grid
with a sticky detail panel. Tiles carry name, rarity and an ownership marker —
never a description or an action. Locked video artifacts read `UNKNOWN ARTIFACT`
(data-driven via `lockedNameBehavior`). Rare reveals may briefly break the rules;
the chrome around them must not.

### Settings / pause

Utilitarian operator panels. Deliberately plainer than the front page.

---

## 8. Background and CRT budget

The application background is a near-black field. There is no radial gradient
behind the shell, no permanent scanlines over text, no chromatic aberration, no
VHS distortion, no glow blob.

The budget for analog character is small and non-negotiable: text readability
wins. The only permitted effects are a subtle raster suggestion and rare,
state-driven interference (the ARTIFACT reveal beat), which honours
`prefers-reduced-motion`.

---

## 9. Do / do not

**Do**

- Separate regions with rules and alignment.
- Give every number a reason to exist.
- Let one element be large and calm while its neighbours are dense.
- Use the cursor, the inverse block, and the rule as the interaction vocabulary.
- Keep the 11px floor and the seven type roles.

**Do not**

- Wrap information in a card because it needs grouping.
- Nest a panel inside a panel.
- Add a coloured left border, a glow, or a pill to make something look designed.
- Track-space an entire screen of uppercase.
- Invent telemetry, fake progress, or decorative system copy.
- Recolour the whole OS for the selected song.
- Add an icon before every label.
- Centre a hero and stack cards beneath it.
