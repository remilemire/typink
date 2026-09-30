# Typink wire protocol (v1)

The Mac app runs a WebSocket server (default port **47321**) advertised over Bonjour as
**`_typink._tcp`** (service name = the Mac's computer name). The iPad app connects to it.
The schemas live in [`packages/protocol/src/index.ts`](../packages/protocol/src/index.ts);
example messages for every type are in [`packages/protocol/fixtures`](../packages/protocol/fixtures)
and are decoded by both the TypeScript and the Swift tests.

## Framing

- **Text frames** carry one JSON object with a `t` (type) field.
- **Binary frames** carry bulky data:

  ```
  [u32 big-endian header length][header JSON (UTF-8)][payload bytes]
  ```

  The header is a normal message. Its `parts` (or per-item `pk`) fields are `[offset, length]`
  byte ranges into the payload.

All geometry is in **typographic points** (1/72 inch). Page coordinates have their origin at the
top-left of the page, y pointing down.

## Session

| Direction | Message | Notes |
|---|---|---|
| iPad → Mac | `hello {proto, deviceId, name, token?, appearance}` | `deviceId` is a UUID kept on the iPad; `token` from an earlier pairing. |
| Mac → iPad | `welcome {proto, macName}` | Token accepted. Followed by `notes`, `note`, `pdf`, `annotations`. |
| Mac → iPad | `pairNeeded {macName}` | Ask the user for the 6-digit code shown on the Mac. |
| iPad → Mac | `pair {code}` | |
| Mac → iPad | `paired {token}` / `pairFailed {reason}` | Store the token in the Keychain. After 5 wrong codes the Mac shows a new code. |

The Mac only accepts `hello` and `pair` before a device is authenticated, and pings every
15 s; unanswered connections are dropped.

The pairing QR code encodes `typink://pair?host=<name>.local&ip=<a,b>&port=<port>&code=<6 digits>`.

## Viewing notes

| Direction | Message | Notes |
|---|---|---|
| iPad → Mac | `listNotes` | Mac answers with `notes`. |
| Mac → iPad | `notes {notes[{path,name,folder,mtime}], active}` | `active` is the note open on the Mac. Re-sent when it changes. |
| iPad → Mac | `view {note \| null, theme}` | `null` follows the Mac's open note. `theme` is the paper the iPad wants. |
| Mac → iPad | `note {note, title, rev, following, pages[{w,h}], sketches[…], ruling}` | Sent before each PDF. `rev` identifies the layout (used by `annotatePut`). |
| Mac → iPad | `pdf {note, rev, theme, parts.data}` (binary) | The note compiled **without** annotations. At most ~1 per second. |
| Mac → iPad | `annotations {note, rev, clusters[{id,page,x,y,w,h,pk}]}` (binary) | Handwriting over the text, positioned for this `rev`. `pk` = PencilKit data in cluster-local coordinates. |

`sketches[]` entries are `{id, page, x, y, w, h, on}`: where each sketch sits on its page, so
the iPad can open one when it's tapped.

## Sketches

| Direction | Message | Notes |
|---|---|---|
| iPad → Mac | `sketchNew {}` | Insert a new sketch at the Mac editor's cursor. The Mac answers with `sketchOpen`. |
| iPad → Mac | `sketchRequest {id}` | Open an existing sketch (tapped on the page). |
| Mac → iPad | `sketchOpen {note, id, rev, size, ruling, background, parts.pk?, parts.background?}` (binary) | `size` is the canvas in pt, 1:1 with the page. `ruling` gives the rule `pitch` and the offset of the first line inside the canvas so handwriting lines up with the page's rules. `background` is set for draw-on-image sketches (bytes in `parts.background`). |
| iPad → Mac | `sketchPut {id, rev, size, render[], parts.pk}` (binary) | The **whole** sketch, sent ~250 ms after each change (last writer wins). `size` may have grown (auto-extend). |
| Mac → iPad | `sketchAck {id, rev}` | The Mac has the sketch (also sent when it ignores a put for a sketch it no longer has). |
| iPad → Mac | `sketchClose {id}` | |

`render[]` is the vector version of the strokes, used by the Mac to draw them in Typst:

```json
{ "ink": "pen|pencil|marker|monoline|fountainPen|other",
  "color": "#rrggbbaa",        // light-appearance colour
  "colorDark": "#rrggbbaa",    // PKInkingTool.convertColor(_, from: .light, to: .dark)
  "points": [x, y, width, opacity, …] }
```

Points come from `PKStrokePath.interpolatedPoints(in:by:)` over each of the stroke's
`maskedPathRanges`, with the stroke's transform applied, so the Mac never deals with
masks or transforms. `width` is the rendered width across the stroke.

## Freeform annotations

| Direction | Message | Notes |
|---|---|---|
| iPad → Mac | `annotatePut {note, viewedRev, pages[], clusters[{id,page,bbox,render[],pk}]}` (binary) | Replaces all handwriting on `pages`. Strokes are grouped into clusters on the iPad (overlapping bounds, per page); `bbox` is page-space `[x, y, w, h]`, `render` and `pk` are cluster-local. |

| Mac → iPad | `annotateAck {note}` | The handwriting is saved (also sent when saving failed; the Mac shows why in a `toast`). |

The Mac anchors each cluster to the paragraph/heading/list it was drawn on (using the layout of
`viewedRev`; when it no longer has that layout, e.g. after a restart, it lays the note out again)
and moves it with that block as the text is edited. It then pushes a fresh `note`, `pdf` and
`annotations`. `rev` numbers keep increasing across restarts of the Mac app.

## Delivery

Ink must survive a Mac that quits, sleeps or drops off the Wi‑Fi. The iPad keeps the latest
`sketchPut` per sketch and the latest `annotatePut` per note until the matching `sketchAck` /
`annotateAck` arrives, and sends whatever is still unconfirmed again after the next `welcome`
from the same Mac. Both messages carry the full state, so a repeat is harmless.

## Photos

| Direction | Message | Notes |
|---|---|---|
| iPad → Mac | `image {name, mime, mode, parts.data}` (binary) | `mode: "insert"` adds `#figure(image(…))` at the cursor; `"drawOn"` creates a sketch with the photo as its background and answers with `sketchOpen`. Send JPEG (≤ 2400 px) or PNG. |

## Misc

`toast {message}` (Mac → iPad) is a short user-facing notice.
