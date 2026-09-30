// Typink note library.
//
// Every note starts with two app-managed lines:
//   #import "/.typink/lib.typ": *
//   #show: note.with(id: "n7x2k9", paper: "a4", template: "lined", font: "serif", size: 11pt)
//
// Compatible with Typst 0.14 and 0.15 (uses `curve`/`tiling`, never `path`/`pattern`).
// The app passes these `sys.inputs`:
//   theme   = "light" | "dark"   paper and ink colours
//   preview = "1"                 live preview (shows placeholders for empty sketches)
//   ann     = "on"                bake handwritten annotations into the output (exports)

#let typink-version = "1"

#let _inputs = sys.inputs
#let _dark = _inputs.at("theme", default: "light") == "dark"
#let _preview = _inputs.at("preview", default: "0") == "1"
#let _bake-annotations = _inputs.at("ann", default: "off") == "on"

#let palette = if _dark {
  (
    paper: rgb("#1c1c1e"),
    ink: rgb("#e5e5e7"),
    muted: rgb("#8e8e93"),
    rule: rgb("#3a3a3f"),
    accent: rgb("#6ea8ff"),
    code-bg: rgb("#27272b"),
    highlight: rgb("#5c4d12"),
    info: rgb("#6ea8ff"),
    tip: rgb("#4fc48b"),
    warning: rgb("#f2b93b"),
    important: rgb("#ff7a70"),
  )
} else {
  (
    paper: rgb("#ffffff"),
    ink: rgb("#1d1d1f"),
    muted: rgb("#6e6e73"),
    rule: rgb("#d3dce8"),
    accent: rgb("#2f6fde"),
    code-bg: rgb("#f3f3f5"),
    highlight: rgb("#fff1a8"),
    info: rgb("#2f6fde"),
    tip: rgb("#1f9d5c"),
    warning: rgb("#b7791f"),
    important: rgb("#d93b30"),
  )
}

#let _papers = (
  "a4": (w: 595.28pt, h: 841.89pt),
  "us-letter": (w: 612pt, h: 792pt),
  "endless": (w: 595.28pt, h: auto),
)

#let _margins = (
  "narrow": (x: 16mm, top: 16mm, bottom: 18mm),
  "normal": (x: 22mm, top: 20mm, bottom: 22mm),
  "wide": (x: 30mm, top: 24mm, bottom: 26mm),
)

#let _fonts = (
  "serif": ("Libertinus Serif",),
  "modern": ("New Computer Modern",),
  "sans": ("Helvetica Neue", "Helvetica", "Libertinus Serif"),
  "mono": ("DejaVu Sans Mono",),
)

#let _line-spacing = ("compact": 1.55, "normal": 1.75, "wide": 2.0)

// Layout facts shared with the helpers below (read inside `context`).
#let _layout = state("typink-layout", (
  id: none,
  ruled: false,
  pitch: 16pt,
  page-w: 595.28pt,
  margin-x: 22mm,
))

// ---------------------------------------------------------------------------
// Helpers

#let _space = [ ].func()

// Plain text of any content, used to fingerprint blocks for annotation anchors.
#let _plain(it) = {
  if it == none { "" }
  else if type(it) == str { it }
  else if type(it) != content { "" }
  else if it.has("text") {
    if type(it.text) == str { it.text } else { _plain(it.text) }
  } else if it.has("children") {
    let parts = it.children.map(_plain)
    if parts.len() == 0 { "" } else { parts.join() }
  } else if it.has("body") { _plain(it.body) }
  else if it.has("child") { _plain(it.child) }
  else if it.func() == _space { " " }
  else { "" }
}

#let _clip(s, n) = {
  let cs = s.clusters()
  if cs.len() <= n { s } else { cs.slice(0, n).join() }
}

// Round a block's height up to a whole number of ruled lines so the text
// after it stays on the ruling. A no-op on the blank template. Only used for
// things that never split across pages (figures, display math); code blocks
// and tables are already whole lines tall on ruled paper.
#let _snap(body, align-to: horizon) = context {
  let cfg = _layout.get()
  if not cfg.ruled { return body }
  layout(size => {
    let h = measure(block(width: size.width, body)).height
    let n = calc.max(1, calc.ceil(h / cfg.pitch - 0.001))
    block(width: 100%, height: n * cfg.pitch, breakable: false, align(align-to, body))
  })
}

#let _as-width(width, available) = {
  if type(width) == length { width }
  else if type(width) == ratio { width * available }
  else if type(width) == relative { width.ratio * available + width.length }
  else { available }
}

/// A hand-drawn sketch made on the iPad. `on` draws the ink over an image
/// (a root-absolute path such as "/attachments/ab12.jpg", or `image(..)`
/// content); `page` picks a page when `on` is a PDF.
#let sketch(id, width: 100%, on: none, page: none, align: center) = layout(size => {
  let cfg = _layout.get()
  let manifest = json("/.typink/manifest.json")
  let info = manifest.at("ink", default: (:)).at(id, default: none)
  let w = _as-width(width, size.width)
  let pos = here().position()

  if info == none {
    if _preview {
      block(
        width: w,
        inset: 8pt,
        stroke: 0.6pt + palette.important,
        radius: 4pt,
        text(size: 0.85em, fill: palette.important)[Missing sketch "#id"],
      )
    }
    return
  }

  let h = w * (info.h / info.w)
  let box-h = if cfg.ruled { calc.max(1, calc.ceil(h / cfg.pitch - 0.001)) * cfg.pitch } else { h }
  let ink-file = "/.typink/ink/" + id + (if _dark { ".dark" } else { "" }) + ".svg"
  let background = if on == none { none } else if type(on) == str {
    if page == none { image(on, width: w, height: h, fit: "stretch") } else {
      image(on, width: w, height: h, fit: "stretch", page: page)
    }
  } else { block(width: w, height: h, clip: true, on) }

  std.align(align, block(width: w, height: box-h, breakable: false, {
    if background != none { place(top + left, background) }
    if info.at("n", default: 0) > 0 {
      place(top + left, image(ink-file, width: w, height: h, fit: "stretch"))
    } else if _preview {
      place(top + left, rect(
        width: w,
        height: h,
        radius: 4pt,
        stroke: (paint: palette.muted.transparentize(40%), thickness: 0.6pt, dash: "dashed"),
        std.align(center + horizon, text(size: 0.85em, fill: palette.muted)[Draw on your iPad]),
      ))
    }
    [#metadata((
      id: id,
      page: pos.page,
      x: pos.x.pt(),
      y: pos.y.pt(),
      w: w.pt(),
      h: h.pt(),
      on: if type(on) == str { on } else { none },
      on-page: page,
    ))<__sketch>]
  }))
})

#let callout(kind: "info", title: auto, body) = {
  let colour = palette.at(kind, default: palette.accent)
  let heading-text = if title == auto { upper(kind.first()) + kind.slice(1) } else { title }
  block(
    width: 100%,
    inset: (left: 12pt, right: 10pt, y: 0pt),
    outset: (y: 5pt),
    fill: colour.transparentize(if _dark { 85% } else { 91% }),
    stroke: (left: 2.5pt + colour),
    radius: (right: 4pt),
    {
      if heading-text != none [#text(weight: "bold", fill: colour, heading-text) \ ]
      body
    },
  )
}
#let info = callout.with(kind: "info")
#let tip = callout.with(kind: "tip")
#let warning = callout.with(kind: "warning")
#let important = callout.with(kind: "important")

#let _checkbox(done) = box(
  width: 0.8em,
  height: 0.8em,
  baseline: 0.06em,
  radius: 2pt,
  stroke: 0.7pt + (if done { palette.accent } else { palette.muted }),
  fill: if done { palette.accent.transparentize(85%) } else { none },
  if done {
    place(curve(
      stroke: (paint: palette.accent, thickness: 1.1pt, cap: "round", join: "round"),
      curve.move((0.17em, 0.42em)),
      curve.line((0.34em, 0.6em)),
      curve.line((0.64em, 0.2em)),
    ))
  },
)

/// A to-do item. Consecutive tasks stack without gaps, like list items.
#let task(done: false, body) = context {
  let cfg = _layout.get()
  let gap = if cfg.ruled { 0pt } else { 0.35em }
  let indent = 1.35em
  block(above: gap, below: gap, par(hanging-indent: indent)[
    #box(width: indent, _checkbox(done))#if done { text(fill: palette.muted, strike(body)) } else { body }
  ])
}

/// Side-by-side columns, e.g. `#cols[Some text][#sketch("id")]`.
#let cols(gutter: 1.2em, widths: auto, ..cells) = {
  let n = cells.pos().len()
  grid(
    columns: if widths == auto { (1fr,) * n } else { widths },
    column-gutter: gutter,
    ..cells.pos(),
  )
}

#let divider() = block(width: 100%, line(length: 100%, stroke: 0.5pt + palette.muted.transparentize(50%)))

#let hl(body) = highlight(fill: palette.highlight, extent: 1pt, body)

/// A small note in the right margin, level with the current line.
#let margin-note(body) = context {
  let cfg = _layout.get()
  let pos = here().position()
  let gap = 4mm
  let width = calc.max(cfg.margin-x.pt() - gap.pt() - 4mm.pt(), 24) * 1pt
  // Shift up by the line's ascent so the note's first baseline matches the text's.
  let ascent = if cfg.ruled { 0.72 * cfg.pitch } else { 0.55em }
  box(width: 0pt, height: 0pt, place(
    top + left,
    dx: cfg.page-w - cfg.margin-x + gap - pos.x,
    dy: -ascent,
    block(width: width, text(size: 0.78em, fill: palette.muted, body)),
  ))
}

// ---------------------------------------------------------------------------
// Page ruling (lined / grid / dotted)
//
// Lines are placed individually rather than with `tiling`: PDF viewers snap
// tiling cells to whole device pixels, which makes the rules drift away from
// the text further down the page.

// Page backgrounds are centred by default, so anchor the layout at the top-left.
#let _ruling(template, pitch, origin-x, origin-y) = place(top + left, layout(size => {
  let first-y = calc.rem(origin-y.pt(), pitch.pt()) * 1pt
  let first-x = calc.rem(origin-x.pt(), pitch.pt()) * 1pt
  let rows = calc.ceil((size.height - first-y) / pitch) + 1
  let cols = calc.ceil((size.width - first-x) / pitch) + 1
  let stroke = 0.5pt + palette.rule
  if template == "dotted" {
    let dots = (
      paint: palette.rule.darken(if _dark { 0% } else { 12% }),
      thickness: 1.7pt,
      cap: "round",
      dash: (0pt, pitch),
    )
    for i in range(rows) {
      place(top + left, dx: first-x, dy: first-y + i * pitch, line(length: size.width - first-x, stroke: dots))
    }
  } else {
    for i in range(rows) {
      place(top + left, dy: first-y + i * pitch, line(length: size.width, stroke: stroke))
    }
    if template == "grid" {
      for j in range(cols) {
        place(top + left, dx: first-x + j * pitch, line(angle: 90deg, length: size.height, stroke: stroke))
      }
    }
  }
}))

// ---------------------------------------------------------------------------
// Introspection for the app: block anchors (annotations follow these) and baked annotations.

#let _block-selector = selector.or(
  par,
  heading,
  list,
  enum,
  terms,
  table,
  figure,
  quote.where(block: true),
  raw.where(block: true),
  math.equation.where(block: true),
  image,
)

#let _foreground(id) = context {
  let pg = here().page()
  // Exact page size (the SVG output rounds to whole points).
  place(top + left, layout(size => [#metadata((page: pg, w: size.width.pt(), h: size.height.pt()))<__page>]))
  let blocks = query(_block-selector).filter(e => e.location().page() == pg)
  [#metadata(blocks.map(e => {
    let p = e.location().position()
    (
      k: repr(e.func()),
      x: p.x.pt(),
      y: p.y.pt(),
      t: _clip(_plain(e).trim(), 160),
      src: if e.func() == image and type(e.source) == str { e.source } else { none },
    )
  }))<__blocks>]

  if _bake-annotations and id != none {
    let placements = json("/.typink/ann/" + id + ".place.json")
    for a in placements.at("items", default: ()).filter(a => a.page == pg) {
      let file = if _dark { a.at("fileDark", default: a.file) } else { a.file }
      place(top + left, dx: a.x * 1pt, dy: a.y * 1pt, image(file, width: a.w * 1pt, height: a.h * 1pt, fit: "stretch"))
    }
  }
}

// ---------------------------------------------------------------------------
// The note template

#let note(
  id: none,
  paper: "a4",
  template: "blank",
  font: "serif",
  size: 11pt,
  margins: "normal",
  spacing: "normal",
  body,
) = {
  let sheet = _papers.at(paper, default: _papers.at("a4"))
  let m = _margins.at(margins, default: _margins.at("normal"))
  let ruled = template in ("lined", "grid", "dotted")
  let pitch = size * _line-spacing.at(spacing, default: 1.75)
  // Absolute line box: every text line (any size) is exactly one pitch tall,
  // with its baseline 72% of the way down, so baselines land on the ruling.
  let top-edge = 0.72 * pitch
  let bottom-edge = -0.28 * pitch
  let families = if type(font) == str { _fonts.at(font, default: (font,)) } else { font }

  set page(
    width: sheet.w,
    height: sheet.h,
    margin: m,
    fill: palette.paper,
    background: if ruled { _ruling(template, pitch, m.x, m.top + top-edge) },
    foreground: _foreground(id),
    footer: if sheet.h != auto {
      context std.align(center, text(size: 0.72em, fill: palette.muted, counter(page).display()))
    },
  )
  set text(font: families, size: size, fill: palette.ink, lang: "en", fallback: true)
  set text(top-edge: top-edge, bottom-edge: bottom-edge) if ruled
  set par(leading: 0pt, spacing: pitch) if ruled
  set block(spacing: pitch) if ruled
  set par(leading: 0.68em, spacing: 1.15em, justify: false) if not ruled
  set block(spacing: 1.15em) if not ruled
  set list(indent: 0.4em, body-indent: 0.55em)
  set enum(indent: 0.4em, body-indent: 0.55em)

  show heading: set text(weight: "bold")
  show heading.where(level: 1): set text(size: 1.5em)
  show heading.where(level: 2): set text(size: 1.25em)
  show heading.where(level: 3): set text(size: 1.08em)
  show heading: set block(above: pitch, below: pitch) if ruled
  show heading: set block(above: 1.35em, below: 0.75em) if not ruled

  show link: set text(fill: palette.accent)
  show raw: set text(font: ("Menlo", "DejaVu Sans Mono"), size: 0.92em)
  show raw.where(block: false): it => box(
    fill: palette.code-bg,
    inset: (x: 3pt),
    outset: (y: 3pt),
    radius: 3pt,
    text(top-edge: "cap-height", bottom-edge: "baseline", it),
  )
  show raw.where(block: true): it => block(
    width: 100%,
    fill: palette.code-bg,
    inset: (x: 10pt, y: if ruled { 0pt } else { 8pt }),
    outset: (y: if ruled { 5pt } else { 0pt }),
    radius: 4pt,
    it,
  )
  set raw(theme: none) if _dark

  // Typst's quote style sets its own block spacing (2.4em/1.8em); keep the rhythm.
  let block-gap = if ruled { pitch } else { 1.15em }
  show quote.where(block: true): it => block(
    above: block-gap,
    below: block-gap,
    inset: (left: 12pt, y: 0pt),
    outset: (y: 3pt),
    stroke: (left: 2pt + palette.muted.transparentize(50%)),
    text(fill: palette.muted, it.body),
  )
  set table(stroke: 0.5pt + palette.muted.transparentize(50%), inset: (x: 6pt, y: if ruled { 0pt } else { 5pt }))
  show figure: it => _snap(it)
  show figure.caption: set text(size: 0.88em, fill: palette.muted)
  show math.equation.where(block: true): it => _snap(it)

  _layout.update((id: id, ruled: ruled, pitch: pitch, page-w: sheet.w, margin-x: m.x))
  [#metadata((
    version: typink-version,
    id: id,
    template: template,
    ruled: ruled,
    pitch: pitch.pt(),
    origin-x: m.x.pt(),
    origin-y: (m.top + top-edge).pt(),
    page-w: sheet.w.pt(),
    margin-x: m.x.pt(),
    dark: _dark,
  ))<__layout>]
  body
}
