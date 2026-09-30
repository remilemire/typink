# Typink

Typst notes on your Mac, with handwriting and diagrams from your iPad and Apple Pencil.

- **Mac app** (Electron): write notes in Typst with a live preview on lined, grid, dotted or
  blank paper, in light or dark mode. Export to PDF, PNG or JPEG.
- **iPad app** (SwiftUI + PencilKit): connects to the Mac over your Wi‑Fi. It can:
  - draw **sketches** that drop into the note at the Mac's cursor
  - **draw on photos**
  - **write anywhere on the page**; this handwriting follows its paragraph when the text changes

Notes are plain `.typ` files in `~/Documents/Typink`, so they work with Git, iCloud Drive and the
`typst` CLI.

## Repository

```
apps/mac/            Electron app (main process, preload, React renderer)
apps/ipad/           iPad app (XcodeGen project.yml, Sources/TypinkPad) + TypinkPadCore Swift package
packages/typst-lib/  lib.typ, the Typst library every note imports, and its tests
packages/protocol/   Mac ⇄ iPad wire protocol: zod schemas + JSON fixtures (shared with the Swift tests)
docs/protocol.md     the protocol, in prose
```

## Mac app

Requires Node 24+ and pnpm.

```bash
pnpm install
pnpm dev                          # run the app with hot reload
pnpm test                         # unit tests (lib.typ on Typst 0.14 and 0.15, protocol, Mac logic)
pnpm --filter @typink/mac e2e     # drives the real app + a simulated iPad
pnpm --filter @typink/mac dist    # unsigned Typink.app in apps/mac/release/
```

The first launch creates `~/Documents/Typink` with a welcome note. **File › Choose Notes
Folder…** points the app at another folder.

### Writing

- The first two lines of every note are managed by the app and shown as a chip ("Lined · A4 ·
  Serif · 11pt"). Click it, or use the paper controls in the toolbar, to change them.
- Type **`/`** at the start of a line for headings, lists, tasks, callouts, math, code, tables,
  columns, sketches, images and more.
- Drag or paste images into the editor. They're copied to `attachments/` and inserted as figures.
- Clicking text in the preview jumps to it in the source.

| Shortcut | Action |
|---|---|
| ⌘B / ⌘I / ⌘U | bold / italic / underline |
| ⌘⇧H / ⌘E / ⌘⇧M | highlight / inline code / math |
| ⌘1 ⌘2 ⌘3 | headings |
| ⌘⇧8 / ⌘⇧7 / ⌘⇧T | bullet list / numbered list / task |
| ⌘⇧D | new sketch at the cursor (opens on the iPad) |
| ⌘⇧I | import image |
| ⌘P | export |
| ⌘\\ | editor / split / preview |
| ⌥⌘S | sidebar |
| ⌘= / ⌘- / ⌘0 | zoom the preview |
| ⇧⌘K | iPad pairing |

### Compiling a note without the app

```bash
typst compile --root ~/Documents/Typink "Notes/Welcome.typ"
```

Handwriting over the text is baked in only by the app's export; plain `typst` renders the note
without it. Sketches and images are always included.

## iPad app

One-time setup on the Mac (needs your password and a large download):

```bash
sudo xcodebuild -license accept
xcodebuild -runFirstLaunch
xcodebuild -downloadPlatform iOS   # only needed for the iPad Simulator
brew install xcodegen
```

Then:

```bash
cd apps/ipad
xcodegen generate                 # creates TypinkPad.xcodeproj from project.yml
open TypinkPad.xcodeproj
```

In Xcode, set your team under *Signing & Capabilities* (a free Apple ID works, but the app then
has to be re-installed every 7 days), then run it on your iPad.

The platform-independent logic (protocol, ink conversion, clustering) builds and checks without
Xcode:

```bash
cd apps/ipad && swift run core-checks
```

### Pairing and use

1. Open Typink on the Mac and on the iPad, on the same Wi‑Fi. Allow **Local Network** access when
   iOS asks.
2. On the iPad, pick your Mac and enter the 6-digit code from the Mac's iPad panel (the iPad icon
   in the toolbar, or ⇧⌘K). You can also scan the QR code shown there.
3. The iPad shows the note that's open on the Mac and follows it; the title menu picks another one.
   - **Sketch** (or ⌘⇧D on the Mac) inserts a sketch at the Mac's cursor and opens it full-screen.
     It uses the note's ruling, grows as you write near the bottom, and updates on the Mac as you
     draw.
   - **Photo** inserts a photo, or opens it as a sketch background to draw on.
   - **Write on the page** lets you handwrite anywhere over the typed text. Tap **Done** to send
     it; it stays attached to the paragraph you wrote on.
   - Tap a sketch on the page to edit it again.
4. If the Mac sleeps or Typink quits while you're drawing, keep going. The iPad keeps your ink,
   shows **Reconnecting…**, and sends everything once the Mac is back.

If the iPad lists your Mac but can't connect, macOS's firewall is probably blocking Typink: allow
it when macOS asks whether Typink may accept incoming connections, or add it in System Settings ›
Network › Firewall › Options.

The Mac announces itself through macOS's own Bonjour service (`dns-sd`), so running Typink never
changes your Mac's name on the network.

## How it fits together

- The Mac compiles notes with [typst.ts](https://github.com/Myriad-Dreamin/typst.ts) (Typst 0.14)
  in a separate utility process, so a slow compile never freezes the window.
- The preview is typst.ts's SVG, split into pages.
- Exports come from Typst's PDF output, or from those SVG pages rasterized with Chromium.
- The iPad receives the note as a PDF and sends ink back as PencilKit data plus a vector form.
  The Mac turns the vector form into SVG files that `lib.typ` embeds, so ink stays sharp in PDFs.
- See [docs/protocol.md](docs/protocol.md) for the details.

## Known limitations

- Textured Pencil inks (pencil, crayon, watercolor) are left out of the tool picker: they can't be
  reproduced faithfully as vectors.
- Handwriting over text is anchored to whole blocks (paragraphs, headings, lists, tables). Ink on a
  list item follows the whole list, and a paragraph that's completely rewritten may lose its
  anchor. The ink then re-attaches to the paragraph before it and never disappears.
- Typed text sits on the ruling for everything `lib.typ` knows about. Hand-written Typst layout
  (custom blocks with odd spacing) can shift the lines below it.
