---
name: Pulse
description: A personal news feed read like a late-evening social scroll.
colors:
  dusk-violet: "#7c5cff"
  flare-pink: "#ff4f9a"
  on-accent: "#ffffff"
  canvas: "#0d0b14"
  surface: "#17141f"
  surface-raised: "#221e2d"
  hairline: "#2c2738"
  ink: "#f5f3fa"
  ink-muted: "#a9a3b8"
  ink-faint: "#827c93"
  accent-ink: "#b9a4ff"
  danger: "#ff7a7a"
  media-ink: "#000000"
  on-media: "#ffffff"
typography:
  poster:
    fontFamily: "Bricolage Grotesque Variable, system-ui, PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif"
    fontSize: "clamp(44px, 13vw, 58px)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "-0.005em"
    fontVariation: "'wdth' 75"
  display:
    fontFamily: "Bricolage Grotesque Variable, system-ui, PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif"
    fontSize: "clamp(34px, 9vw, 52px)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.005em"
    fontVariation: "'wdth' 75"
  headline:
    fontFamily: "Bricolage Grotesque Variable, system-ui, PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.005em"
    fontVariation: "'wdth' 75"
  title:
    fontFamily: "Bricolage Grotesque Variable, system-ui, PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.005em"
    fontVariation: "'wdth' 75"
  prose:
    fontFamily: "Bricolage Grotesque Variable, system-ui, PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.65
  body:
    fontFamily: "Bricolage Grotesque Variable, system-ui, PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Bricolage Grotesque Variable, system-ui, PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.25
rounded:
  control: "8px"
  card: "12px"
  sheet: "16px"
  pill: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
components:
  button:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-active:
    backgroundColor: "{colors.hairline}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-primary-active:
    backgroundColor: "{colors.ink-muted}"
  icon-button:
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    size: "40px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "40px"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "34px"
  chip-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.card}"
    padding: "12px 16px"
  menu:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.card}"
    padding: "4px"
    width: "200px"
  type-tile:
    textColor: "{colors.on-media}"
    typography: "{typography.poster}"
    padding: "24px"
---

# Design System: Pulse

## Overview

**Creative North Star: "The Night Feed"**

Pulse is a social scroll at the end of the day. The chrome is dark and quiet: a violet-black canvas, hairline dividers, near-white type, no shadows, no cards around posts. Colour is rationed. The Dusk Violet to Flare Pink gradient appears only where something is new, loved or missing an image: unread story rings, the wordmark, like hearts, and the type tiles that stand in for absent photos. Everything else is ink on dark.

Type does the talking. One family, Bricolage Grotesque, runs in two voices: headlines condensed to 75% width at weight 800, tight and tabloid-heavy; everything else at normal width and regular weight. The contrast between the squeezed, heavy headline and the open body is the system's main hierarchy device, and it holds for Chinese text through the PingFang SC / Microsoft YaHei / Noto Sans SC fallbacks.

The layout is a phone feed first. A single 560px column with a bottom tab bar becomes, at 900px, a left navigation rail, and at 1240px gains a right rail for trends. Density stays social-app loose: full-bleed media, generous tap targets, one story per screen-height.

**Key Characteristics:**
- Dark by default; a light theme mirrors every neutral role.
- Gradient reserved for signal: unread, liked, wordmark, image-less posters.
- Condensed heavy headlines against open regular body.
- Flat: depth comes from tonal surfaces and hairlines, never shadows.
- Full-bleed media in the feed; rounded sheets only for overlays.

## Colors

A violet-tinted dark neutral scale carrying two hot accents that only ever meet as a gradient or stand alone as signal.

### Primary
- **Dusk Violet** (`dusk-violet`): the gradient's start. Alone it marks text selection and fills chart bars in Profile and Activity. It never fills a button.

### Secondary
- **Flare Pink** (`flare-pink`): the gradient's end and the colour of a like. Alone it fills liked hearts, unread dots on the tab bar and rows, and count badges beside group titles.

### Neutral
- **Night Canvas** (`canvas`): page background, top bar and tab bar. Light theme: white.
- **Dim Surface** (`surface`): inputs, inactive chips, image placeholders, skeletons.
- **Raised Surface** (`surface-raised`): secondary buttons, menus, story-viewer step buttons, pressed icon buttons.
- **Hairline** (`hairline`): every divider and border, 1px. Also the pressed state of secondary buttons.
- **Moon Ink** (`ink`): primary text, and the fill of primary buttons, active chips and toasts, which invert to canvas-coloured text.
- **Muted Ink** (`ink-muted`): secondary text, inactive nav icons, empty-state copy.
- **Faint Ink** (`ink-faint`): timestamps, topic names, placeholders.
- **Lilac Ink** (`accent-ink`): the readable-on-dark violet for focus rings, focused input borders and the "summarized" marker. Light theme: `#6a3df0`.
- **Soft Red** (`danger`): error text only.

### Named Rules
**The Signal-Only Gradient Rule.** The violet-to-pink gradient means "new", "loved" or "this story has no picture". It never decorates a button, background panel or heading.

**The Ink Button Rule.** The strongest action on a screen is an ink-filled button with canvas text, not an accent-filled one. Accent colour on controls would compete with the signal it is reserved for.

## Typography

**Display Font:** Bricolage Grotesque Variable at 75% width, weight 800
**Body Font:** Bricolage Grotesque Variable at normal width, weight 400–600
**Fallbacks:** system-ui, then PingFang SC, Microsoft YaHei, Noto Sans SC for Chinese

**Character:** One grotesque in two voices. The condensed heavy cut gives headlines the urgency of a tabloid front page; the normal cut keeps body copy friendly and easy at small sizes.

### Hierarchy
- **Poster** (800, `clamp(44px, 13vw, 58px)`, 0.98): headlines on image-less story-viewer posters, set on the gradient. Feed type tiles use the same voice one step down (`clamp(30px, 9.4vw, 46px)`), and story headlines over a photo use `clamp(30px, 9vw, 38px)`.
- **Display** (800, `clamp(34px, 9vw, 52px)`, 1): article titles in the Reader.
- **Headline** (800, 26px, 1.05): post headlines in the feed.
- **Title** (800, 24px, 1.05): top-bar page titles, section and group titles, empty-state headings.
- **Prose** (400, 17px, 1.65): extracted article text in the Reader, in a column of at most 680px (760px on wide screens).
- **Body** (400, 15px, 1.5): feed summaries, settings, general UI.
- **Label** (600, 13px): buttons, chips, metadata, badges. Source names in bylines use 600 at body size.

### Named Rules
**The Two Voices Rule.** Condensed width and weight 800 go together and belong only to headings. Body text is never condensed; headings are never regular weight.

**The Balanced Headline Rule.** Large headlines use `text-wrap: balance`; post headlines and prose use `pretty`. Type-tile headlines are clamped to five lines.

## Layout

Mobile-first, in a 4px spacing scale (4, 8, 12, 16, 24, 32, 48). Side gutters are 16px on phones.

- **Below 600px:** one column, sticky 56px top bar, fixed 56px bottom tab bar respecting the safe-area inset. Post media runs full-bleed at 3:2. The story viewer fills the screen.
- **600px and up:** the feed centres at 560px (`--feed-width`); wide pages (Explore grid, Profile) at 940px. The story viewer becomes a 9:16 sheet, at most 820px tall, over a blurred backdrop with step buttons either side.
- **760px and up:** the Reader becomes a 760px sheet rising from the bottom with rounded top corners.
- **900px and up:** the tab bar becomes a 232px sticky left rail with the wordmark and text labels; the active item goes bold.
- **1240px and up:** pages that carry it add a 320px right rail for trends and tracked keywords.

Story rows and topic chips scroll sideways with a canvas-coloured fade at each edge.

## Elevation & Depth

Pulse is flat. There is no `box-shadow` anywhere. Depth comes from three tonal steps (canvas, surface, raised surface) and 1px hairlines. Overlays separate from the page with a dimmed backdrop (`rgb(8 6 14 / 0.76)` dark, `rgb(20 17 28 / 0.5)` light) and, once the overlay becomes a sheet (600px for the story viewer, 760px for the reader), a 12px backdrop blur.

### Named Rules
**The No-Shadow Rule.** Raise a layer by stepping its surface tone or putting a backdrop behind it, never by casting a shadow.

## Shapes

Four radii, each tied to a scale of object: 8px for controls (buttons, inputs, nav items, focus rings), 12px for cards, menus, toasts and inline media boxes, 16px for sheets (story viewer, reader bottom sheet, top corners only when docked), and full pills for avatars, chips, icon buttons and badges. Feed posts have no outline or radius at all: they are separated by a hairline and their media runs edge to edge.

Avatars are circles. A source with unread stories gets a 3px gradient ring drawn as an SVG stroke around its avatar; a read source's ring falls back to hairline.

## Components

### Buttons
Quiet by default, inverted for the main action.
- **Shape:** gently rounded (8px), 40px tall, 16px side padding, label type.
- **Secondary:** raised surface with ink text; pressed state steps to hairline.
- **Primary:** ink fill with canvas text; pressed state softens to muted ink.
- **Icon button:** 40px circle, no fill at rest, raised surface when pressed.
- **Feedback:** state changes on `:active` (touch-first). Focus shows a 2px Lilac Ink outline offset 2px.

### Chips
- **Style:** 34px pill, dim surface, muted ink label at 600.
- **State:** the selected chip inverts to ink fill with canvas text. Used for topic filters and platform choices.

### Inputs
- **Style:** 40px tall, dim surface, 1px hairline border, 8px radius, faint-ink placeholder.
- **Focus:** the border turns Lilac Ink; no glow.

### Navigation
- **Phone:** fixed bottom tab bar of icons only, muted at rest; the active icon turns ink and its stroke thickens to 2.6. A Flare Pink dot with a canvas-coloured ring marks unseen activity.
- **900px+:** left rail with the gradient wordmark, icon plus 17px label, active label bold.

### Post (signature)
The feed's unit, built like a social post rather than a news card: byline row (avatar, source name at 600, topic and age in faint ink), full-bleed 3:2 media, an action row (like, summarize, save pushed right), then the condensed headline and summary. Double-tapping the media fires a white heart burst (700ms); a like pops the heart into Flare Pink (260ms).

### Type Tile (signature)
When a story has no image, its media slot becomes a gradient tile with the headline set in Poster type, white, bottom-left aligned. The gradient angle is derived from the source id, so each source keeps a recognisable direction while every tile stays in the same two colours. A compact variant (17px, 12px padding) appears in grids.

### Story Ring and Viewer (signature)
A sideways rail of ringed avatars, one per source. The viewer shows one story at a time over a blurred, darkened wash of its own image (or the gradient when there is none), with progress segments that fill linearly across the top.

### Toasts and Menus
Toasts are ink-filled 12px-radius slips that rise 8px into place over 180ms, above the tab bar. Menus are raised-surface panels with a hairline border and 40px rows.

## Do's and Don'ts

### Do:
- **Do** keep the violet-to-pink gradient for unread rings, the wordmark, likes and image-less type tiles.
- **Do** make the main action an ink-filled button with canvas text.
- **Do** pair 75% width with weight 800 on every heading, and keep body text at normal width.
- **Do** separate feed items with a 1px hairline and let media run full-bleed.
- **Do** define every new colour role for both the dark and light themes.
- **Do** check headings and labels with Chinese text; the condensed axis does not apply to CJK fallbacks, so line lengths change.
- **Do** keep motion short (120–260ms for state, 700ms for the like burst) and let the reduced-motion rule flatten it.

### Don't:
- **Don't** add `box-shadow`; step the surface tone instead.
- **Don't** fill buttons, panels or section backgrounds with Dusk Violet, Flare Pink or the gradient.
- **Don't** wrap feed posts in bordered or rounded cards.
- **Don't** introduce a second typeface; contrast comes from width and weight within Bricolage Grotesque.
- **Don't** use Flare Pink for errors; Soft Red is the only error colour.
