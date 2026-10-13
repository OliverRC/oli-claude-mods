# Mod theme

The look Clean View uses, written down so future mods can match it. The values live in
`hooks/clean-view.tsx` (`PALETTE`, `TITLE_RAMP`, `SWEEP_FADE`, `SPARKLE`); this file explains them.

## The feel

Calm, soft and friendly. Pastel colours on a dark terminal, one gentle frame, little motion,
and plain words. Nothing should look like a log, a diff or an error dump. Colour carries
meaning (state, progress), and everything else stays quiet.

## Palette

A Catppuccin-style set of pastels, tuned for dark backgrounds.

| Name | Hex | Used for |
|---|---|---|
| peach | `#FAB387` | start of gradients |
| pink | `#F38BA8` | the main accent: working border, current-step marker, labels |
| mauve | `#CBA6F7` | middle of gradients |
| blue | `#89B4FA` | end of gradients |
| green | `#A6E3A1` | done: checks, border, labels |
| yellow | `#F9E2AF` | needs you: badge, border, paused marker |
| red | `#EBA0AC` | stuck: header and border (a soft rose, never alarm red) |
| text | `#CDD6F4` | the current step's name |
| subtle | `#7F849C` | secondary text: timer, step count, done and upcoming names |
| track | `#45475A` | empty meter cells and bar outlines |

Supporting ramps:

- **Title:** peach → pink → mauve → blue, one colour per word, bold.
- **Step meter (filling):** pink → mauve → blue across the 10 cells.
- **Done meter:** deep green `#40A02B` → green.
- **Working streak:** `#3B3052` → `#5B4A7A` → `#8C7BD0` → `#B4BEFE`, fading from tail to head.

## State colours

Each state has one accent. It tints the border, the overall bar and the percent.

| State | Accent | Overall bar ramp |
|---|---|---|
| Working | pink | peach → pink |
| Needs you | yellow | peach → yellow |
| Stuck | red | peach → red |
| Stopped | subtle | track → subtle |
| Done | green | deep green → green |

## Layout

```
╭──────────────────────────────────────────────────────────────╮
│ ✶ Build my landing page                1m 12s [● Clean View: ON] │
│ Step 2 of 4  ▰▰▰▰▱▱▱▱▱▱  38%                                  │
│ ✓ Read your brand notes      ██████████  Done                │
│ ▶ Build the pricing section  ██████░░░░  60%                 │
│ ○ Add the contact form       ░░░░░░░░░░  Next                │
│ ○ Polish the footer          ░░░░░░░░░░  Up next             │
╰──────────────────────────────────────────────────────────────╯
```

- **Frame:** one rounded border (`borderStyle="round"`) in the state's accent, with one cell of
  padding on each side. Only one frame: no nested boxes and no dividers.
- **Header row:** the status glyph and title on the left. The timer and the toggle button sit on
  the right on every screen.
- **Step line:** "Step N of M" in subtle, a compact 10-cell bar, then the percent. It's a quiet
  summary, never a full-width bar.
- **Rows:** glyph (2 cells), name column, 10-cell meter, then a short label. Size the name column
  from `bodyColumns` so rows never wrap. Truncate with "…".
- **Collapsed:** a finished job shrinks to its header line, still inside its green frame.
- **Off or idle:** no frame, just the toggle button on the right.

## Glyphs

| Glyph | Meaning |
|---|---|
| ✶ ✷ ✸ ✹ ✺ | working sparkle in the header, cycling |
| ✓ | done (green) |
| ▶ | current step (pink) |
| ‖ | current step, paused waiting on you (yellow) |
| ○ | upcoming step (subtle) |
| █ / ░ | step meter, filled / empty |
| ▰ / ▱ | overall bar, filled / empty |
| ⚠ | stuck |
| ■ | stopped |
| ● / ○ | toggle on / off |

## Type

- **Bold:** the title, the current step's name, its label, and the Needs you badge.
- **Subtle colour, not dim:** done and upcoming names, the timer and the step count. Use the
  `subtle` hex rather than `dimColor` so the tone matches across terminals.
- **Inverse:** used only for the **Needs you** badge, so it's the one thing that shouts.

## Motion

- One 250ms clock drives everything, and it runs only while a job is working or waiting on
  you. Nothing animates while idle.
- The sparkle cycles one glyph per tick.
- With no percent yet, a four-cell streak bounces across the step meter, fading from tail to head.
- Done waits 5 seconds, then collapses to one line.

## Words

- Step and job names are plain English, under 40 characters, and start with a verb.
- No file names, paths, commands, code or tool names anywhere in the band.
- State messages are one calm sentence: "Claude needs your OK to continue", "you hit your usage
  limit, try again a little later".

## Known limits

- The colours are fixed hex values for dark themes. On a light terminal theme they will look
  washed out.
- The sizes assume a monospace terminal cell; the desktop surface draws the same tree.
