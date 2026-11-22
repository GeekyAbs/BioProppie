# Everest Design System

**Source:** everest-tech.netlify.app (as of the live page)
**Purpose:** Living reference for design decisions, palette, typography, and component patterns on the Everest site.

> Note: This spec covers the marketing/presentational design only — 3D vector rendering and generative model infrastructure are out of scope here.

---

## 1. Design Philosophy

The site reads as **Alpine expedition** rather than generic SaaS. The dominant metaphor is a mountain route: Everest, camps, South Col, Summit. Design choices reinforce:

- **Airiness & altitude** — vast hero sections, generous vertical rhythm, sky-toned backgrounds that feel like high altitude.
- **Map/route visualization** — a flying helicopter, a route path, camp markers; the journey is the content.
- **Edgy, premium typography** — narrow, wide-letter-spaced display type; a mono for data/labels; a serif italic for editorial accents.
- **Dark ink on light sky** — high contrast, premium feel, with a dark mode variant.
- **Smooth, bouncy motion** — `cubic-bezier(.7, 0, .2, 1)` (springy) for hover/enter, `ease-out` for scroll transitions. No rigid linear motion.

---

## 2. Color Palette

### Palette Variables

| Variable | Hex | Usage |
|---|---|---|
| `--ink` | `#1e1035` | Primary text, buttons, headings, accent |
| `--ink-2` | `#3d2d63` | Secondary text, body emphasis |
| `--ink-3` | `#6b6190` | Tertiary labels, muted copy |
| `--baby` | `#cfe3f5` | Transparent white tint (-flight map, highlights) |
| `--baby-2` | `#b8d4ef` | Secondary tint (grouped backgrounds) |
| `--sky` | `#e6f0f9` | Page base background (gradient) |
| `--paper` | `#f7f6f2` | Sheets, cards, form backgrounds |
| `--white` | `#ffffff` | Pure white (text on dark, cards) |
| `--line` | `#1e103529` | 16% opacity ink (borders) |
| `--line-strong` | `#1e103566` | 40% opacity ink (strong borders) |
| `--sky-top` | `#d3e5f6` | Top of fixed sky gradient |
| `--sky-mid` | `#e6f0f9` | Middle of fixed sky gradient |
| `--sky-horizon` | `#f6f8fa` | Bottom of fixed sky gradient |

### Background

The page background is a **fixed, vertically-graded sky** (light blue → mid blue → near-white), plus a **sky canvas scene** with stars and a mountain silhouette (with a fallback gradient).

### Dark Mode

Dark mode is applied via `html[data-sky="dark"]`: text becomes white (`#fff`), the CTA becomes white with dark text, and the `nav`, `hud`, and `summit` elements shift to dark variants (`--ink` with alpha transparency, white text).

### Text Selection

`::selection` = `var(--ink)` background with `var(--white)` text — dark selection on the page.

---

## 3. Typography

### Font Stack

| Role | Font | Weights | Fallback |
|---|---|---|---|
| Display / headings | **Archivo** | 100–900 | Helvetica Neue, Arial, sans-serif |
| Mono / labels / data | **JetBrains Mono** | 400, 500 | `ui-monospace, "SF Mono", Menlo, monospace` |
| Serif (editorial accent) | **Instrument Serif** (italic only) | 400 | Georgia, serif |

Baseline body text uses `--f-display` (Archivo), with generous `line-height: 1.45` on `<body>`.

### Display / Headings

- **Archivo, very wide tracking** is the signature:
  - Hero title: `font-weight: 640`, `letter-spacing: -0.038em`, `font-stretch: 112%`, `line-height: 0.93`
  - Block titles: `font-weight: 700`, `letter-spacing: -0.045em`, `font-stretch: 116%`, `line-height: 0.88`
  - Cap index: `letter-spacing: 0.1em`, uppercase, mono
  - Log rows: `letter-spacing: 0.1em`, uppercase, mono
  - Summits: `font-weight: 660`, `letter-spacing: -0.04em`, `font-stretch: 112%`
- Sizes are **clamped**, not fixed: `clamp(min, preferred, max)` combinations across viewport.
- Emphasized serif italic (`Instrument Serif`) is used in editorial contexts: the `<aside>` tagline, letter-form sections, the "Register" empty state.

### Monospace

- JetBrains Mono is used for: eyebrow labels, navigation text, button labels, the footer, form labels, superscript numbers, the register data, and the UGC-style UI labels. 10–12px is the typical size in this role.
- `letter-spacing: 0.08–0.14em` + `text-transform: uppercase` is the default mono treatment.

### Layout/Rhythm

- `--gutter: clamp(18px, 4.2vw, 64px)` — responsive horizontal padding, widest at large screens.
- `--nav-h: 64px` — fixed top navigation height.
- Body font-size: `16px`, line-height `1.45`.
- Max-width for blocks/headlines: `min(600px, 44vw)` on desktop; `min(560px, 54vw)` in mid-screen; `100%` + `width:100%` on mobile (under 640px).

---

## 4. Layout & Structure

### Page Grid / Scaffold

- **No strict CSS grid** for the main layout; the structure is **fixed full-screen "stages"**, each a `<section>` with a large min-height (`150–220svh`), stacked vertically. This is a full-page-scroll journey, not a wireframe grid.
- **Fixed top navigation** (`--nav-h: 64px`, `z-index: 12`) with brand, links, and a CTA.
- **Sticky PIIN** (`.stage__pin`) on each stage: a vertical anchor column near the stage's left gutter containing the eyebrow + title + actions. On the hero it aligns to `flex-end`; on others to `flex-start`.
- **Fixed decorative layers** (z-index 0–4): the sky gradient, star field canvas, mountain silhouette, route-marker "labels", and HUD scale readout.

### Spacing System

```
--gutter: clamp(18px, 4.2vw, 64px)

--nav-h: 64px
--ease: cubic-bezier(.7, 0, .2, 1)     ← springy
--ease-out: cubic-bezier(.16, 1, .3, 1) ← snappy out
```

Section spacing rules (consistent):
- `.eyebrow` → title: `margin: 0 0 22px`
- `.block` / `.hero` → `margin: 0 0 34px` (top)
- `.cap__title` → `margin: 0 0 22px` (below title); `.cap__line` → `margin: 22px 0 0`
- `.cap__spec` list → `margin: 28px 0 0`
- `.log` / `.register` → `margin: 30px 0 0`
- `.contact` grid → gap 22px horizontally, 20px vertically

### Breakpoints / Responsive Rules

- `max-width: 1100px`: blocks/hero cap down to `min(560px, 54vw)`; case list + steps go `1fr` grid.
- `max-width: 640px` or `max-aspect-ratio: 4/5`: `--nav-h` shrinks to `58px`; nav links hide, mobile menu (`nav__menu`) appears; blocks become full-width `100%` with `border: 1px solid var(--line)` cards; the main `.block--work`/`.block--flags` body is hidden; `hud` becomes a vertical `writing-mode: vertical-rl` label rail; the fixed sky stays; `foot` goes column.
- `prefers-reduced-motion`: transitions to `~0.2s`, animations disabled.
- `max-height: 640px` + wide aspect: hero/lede and scroll cue hide, hero padding reduces.

### Sticky & Fixed Elements

| Element | Behavior |
|---|---|
| `.nav` | Fixed, `z: 12`, `top:0` |
| `.sky` | Fixed full-screen, gradient bg, `z: 0` |
| `.giant` | Fixed wide tall mountain mark, `z: 3`, below nav |
| `.stars` | Fixed full-screen, starfield, `z: 1` |
| `.scene` / `.scene canvas` | Fixed full-screen, 3D-rendered mountain scene, `z: 2` |
| `.stage__pin` | `position: sticky; top: 0`, within each `.stage` |
| `.hud` | Fixed right rail, `z: 10`, altitude meter |
| `.sheet` / `.sheet__panel` | Fixed overlay panel (modal) for form/contact, `z: 30` |
| `.tag` / `.labels` | Fixed full-screen "flag" labels for route markers, `z: 3` |

### Interactive Patterns

- **Hover links**: 5px × 5px diagonal "hook" triangle animates from top-left of the link underline (`:before`, `transform: translateY(-50%) rotate(45deg) scale(0) → scale(1)`).
- **Buttons**: three variants — `--btn--solid` (ink bg + white text), `--btn--line` (ink text, transparent), `--btn--light` (white bg, ink border). Primary CTA in nav is solid ink with a hover lifting to `ink-2`.
- **Log rows**: `border-bottom: 1px solid` list with hover → white bg + `padding-left: 14px` + open state that slides in a "→" indicator.
- **Register/contact form**: fields below the fold; submit turns into a "done" state with a thank-you message and a "hop" animation (small red dot `hop` keyframe, `translateY(-8px)` at 30%).
- **Copy-letter form**: a `letter-wrap` interactive that looks like a physical page with 3D rotation (`--rx`/`--ry` transforms, `transform-style: preserve-3d`), a stamp animation (`stamp-spin` 14s rotation) and a seal pop.
- **Flight map SVG**: a 16:10 map with route path, camp markers, snow, helicopter (animated `heli-fly` path, rotating tilt), and envelope. Hidden on mobile (`@media (max-width:640px)`).

---

## 5. Components

### Buttons

| Variant | Class | Appearance |
|---|---|---|
| Solid | `btn--solid` | `background: --ink; color: --white`; hover → `--ink-2` |
| Line | `btn--line` | ink text, transparent bg; hover → white bg |
| Light | `btn--light` | white bg, ink border; hover → `--baby` |

- Fixed: `height: 50px`, `padding: 0 22px`, `font-size: 15px`, `font-weight: 560`, `text-decoration: none`, `display: inline-flex`, `align-items: center`, `gap: 10px`.
- Letter-spacing: `0.005em` on button (near-normal), unlike the wide-tracking display text.

### Nav

- Height `var(--nav-h)` (64px), `padding: 0 var(--gutter)`, `justify-content: space-between`.
- Brand: 118px-wide logo mark.
- Links: 14px, `font-weight: 520`, flex; each link has a colored triangle anchor that animates on hover.
- CTA: `height: 38px`, `padding: 0 16px`, `font-weight: 560`, ink bg + white text, hover → `ink-2`.
- Mobile nav menu button: 11px mono, `letter-spacing: .16em`, uppercase, bordered 38px tall.

### Hero Section

- `stage--hero`, `height: 150svh`.
- Sticky PIIN pinned to `flex-end` at bottom (`padding-bottom: clamp(36px, 9svh, 96px)`), containing:
  - Eyebrow (`11px` mono, uppercase, `1.2` leading, `--ink-2` color, flex wrap, with `span+span` connector line)
  - Hero title (`clamp(36px, 5.4vw, 88px)` Archivo 640, wide tracking, near-black on `line-height .93`)
  - Lede (`44ch max-width`, `ink-2`, `1.25vw`-sized, `16–19px`)
  - Action buttons (`gap: 12px`, margin-top `28px`)
  - Scroll cue (scaled up `cue` animation, 2.2s infinite loop)

### Cap / Feature Block (`.cap__title` + `.cap__line` + `.cap__spec`)

- `.cap__title`: `clamp(50px, 7.4vw, 128px)`, `font-weight: 700`, `letter-spacing: -0.045em`, `font-stretch: 116%`, `line-height: 0.88` — the large heading pattern.
- `.cap__line`: `max-width: 24ch`, `clamp(19px, 1.7vw, 26px)`, `font-weight: 480`, `line-height: 1.22` — the narrow supporting line, width-limited to ~24 characters.
- `.cap__spec`: flex wrap list of bordered chips (`1px solid --line-strong`, white `80%` bg, 11px mono, uppercase, `letter-spacing: .08em`).
- `.cap__detail`: `max-width: 54ch`, 15px, `line-height: 1.55`.

### Log / Timeline

`.log` (max-width `min(620px, 46vw)`):
- `border-top: 1px solid --ink`
- Rows: `grid-template-columns: 110px 1fr auto`, the number column is 56px wide (11px bold mono, `-0.025em`), title is Archivo 640 `clamp(20px, 1.9vw, 28px)` wide tracking, kind is mono uppercase `ink-3`, open state is hidden except on hover.
- Hover row → white bg + left padding + the "open" indicator appears (`.log__open:after` → " →").

### Register / Contacts

`.register` (max-width `min(560px, 44vw)`):
- Count row: `border-bottom: 1px solid --ink`, 11px mono uppercase, with a huge number (`clamp(64px, 7vw, 112px)`, wide letter-spacing `-0.05em`).
- Empty state: serif italic 26px.
- List rows: 2-column (28px number + text + action), `border-bottom: 1px solid --line-strong`, hover → white bg.

### Summit Section

`stage--summit`, full screen, `color: --white`.
- Eyebrow: `rgba(255,255,255,0.82)` with white camp chip.
- Title: `clamp(32px, 5.6vw, 96px)`, 660, wide tracking.
- Actions: centered flex, gap 22px.
- Mail link: `12px` mono, `text-underline-offset: 4px`, `background: rgba(30,16,53,0.54)`.
- All text has `text-shadow: 0 2px 28px rgba(--ink, 0.45)` for readability over the mountain scene.

### Mobile Sheet Modal

`.sheet` full-screen overlay (`z: 30`):
- Scrim: `#1e103538` (a 22% black).
- Panel: `--paper` bg, `border-left: 1px solid --ink`, `width: min(600px, 100vw)`, right-side fixed, vertical scroll, `padding: 84px clamp(22px, 4vw, 52px) 48px`.
- Close: 11px mono uppercase, top-right.
- Form fields: bottom border only (no full input border), focus → white bg + `inset 0 -2px 0` ink shadow.
- Submit button: `justify-items: start`, gap 14px.
- After submit: `.contact__thanks` fades in, `.contact__karve` dot hops.

---

## 6. Motion & Interactions

### Easing

```
--ease: cubic-bezier(.7, 0, .2, 1)   ← springy, used for hover/enter of interactive elements
--ease-out: cubic-bezier(.16, 1, .3, 1) ← snappy, used for scroll/animation entrance
```

### Key Animations

| Keyframe | Purpose | Duration | Easing |
|---|---|---|---|
| `load` | Loader bar (scaleX 0→1→0) | 1.6s | `--ease` |
| `cue` | Scroll indicator up-down | 2.2s | `--ease` |
| `quip` | Tag popup | 0.35s | `--ease-out` |
| `hop` | Contact done dot | 1.2s | `--ease-out` |
| `letter-in` | 3D letter page in | 0.9s | `--ease-out` |
| `letter-seal` | Seal seal | 0.7s | `--ease` |
| `stamp-spin` | Rotating stamp (loop 14s) | 14s linear | — |
| `env-move` / `env-gone` | Letter float | ~2s | `--ease` |
| `env-letter` | Letter fly-in | 0.8s | `--ease` |
| `env-flap` | Envelope flap | 0.7s | `--ease` |
| `seal-pop` | Seal pop | 0.3s | `--ease-out` |
| `heli-fly` | Helicopter route | 4s | `--ease` |
| `rotor` | Helicopter rotor | infinite `.12s` linear | — |

### Motion Philosophy

- Entrance animations are **staggered** (1.7s–4s delays), timed against the long scroll stages.
- The helicopter flies, the letter floats, the stamp spins — the page is a "scene," not a static page.
- Focus states: `outline: 2px solid --ink; outline-offset: 3px`.

---

## 7. Decorative Layers

### Fixed Background Scene

1. **Sky** (`z: 0`): `linear-gradient(180deg, --sky-top 0%, --sky-mid 42%, --sky-horizon 78%)`.
2. **Stars** (`z: 1`): starfield canvas, `opacity: 0` until `data-ready="1"`.
3. **Mountain scene** (`z: 2`): 3D-rendered mountain with silhouette, canvas element, `opacity 0 → 1` over 1.4s.
4. **Labels** (`z: 3`): fixed full-screen flag/tag labels for the route (camps, route markers), with hover-activated captions.
5. **Giant** (`z: 3`): wide tall mountain silhouette image (118svh tall), marking the route.
6. **HUD** (`z: 10`): altitude scale readout on right rail, shows current "altitude" tick + readout.

---

## 8. Component Patterns Checklist

- **Hero**: eyebrow + clamp title + lede + actions + scroll cue
- **Cap block**: index + wide tracking title + supporting line + spec chips
- **Navigation**: fixed, brand + links + CTA; mobile menu toggle
- **Log/timeline rows**: hover reveals open state
- **Register form**: count row + numbered list + submit → done state
- **Contact sheet**: modal panel, field bottom-border only, focus ring, submit → thanks
- **Copy letter**: 3D transform letters, stamp spin, seal pop, email/message inputs
- **Flight map**: SVG route + helicopter + envelope + snow, animated path
- **Summit section**: full-bleed white text + shadow, CTA row + mail
- **Footer**: 10.5px mono uppercase, two-column, credit link
- **Lazy/decorative**: stars, mountain scene, giant silhouette, HUD scale

---

## 9. File Structure Suggestion

```
/docs
  design.md          ← this file (living spec)
/src
  /components        ← design-system components (buttons, nav, badges, etc.)
  styles/
    _variables.css   ← CSS custom properties (palette, fonts, spacing, easing)
    _typography.css  ← font-face imports + heading/body serifs/mono
    _layout.css      ← gutter/navigation/stage heights/resets
    /_components/    ← .btn, .nav, .hero, .cap, .log, .register, .sheet, etc.
    _utilities.css   ← clamp sizes, text-shadow, focus states, reduced-motion
/tokens
  colors.json        ← hex + usage notes (consumer of design.md)
  typography.json    ← font families, weights, sizes, tracking
```

---

## 10. Open Questions

- Dark mode toggle is currently `data-sky="dark"` on `<html>`, not a UI switch — confirm intended interaction.
- The 3D scene canvas and mountain raster are currently inline/generated — decide if they are locked as decorative or should be a design capability.
- Hero/PIIN sticky position (`flex-end` on hero, `flex-start` elsewhere) — this is a deliberate flip worth keeping consistent.
- Mobile breakpoint is both `<640px` OR `max-aspect-ratio: 4/5` — confirm this quadrant rule is intended.
