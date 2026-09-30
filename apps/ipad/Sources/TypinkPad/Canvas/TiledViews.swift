// Views drawn underneath the PencilKit canvas. They use CATiledLayer so they
// stay sharp at any zoom level. CATiledLayer draws on background threads, so
// the drawing code is nonisolated and only reads immutable state.

import TypinkPadCore
import UIKit

/// One page of the note's PDF.
final class TiledPDFPageView: UIView {
  override class var layerClass: AnyClass { CATiledLayer.self }

  nonisolated(unsafe) private let page: CGPDFPage
  nonisolated private let paper: CGColor

  init(page: CGPDFPage, frame: CGRect, paper: UIColor) {
    self.page = page
    self.paper = paper.cgColor
    super.init(frame: frame)
    configureTiles(layer as! CATiledLayer)
    backgroundColor = paper
    layer.shadowColor = UIColor.black.cgColor
    layer.shadowOpacity = 0.12
    layer.shadowRadius = 6
    layer.shadowOffset = CGSize(width: 0, height: 2)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError() }

  override func draw(_ rect: CGRect) {}

  nonisolated override func draw(_ layer: CALayer, in ctx: CGContext) {
    let bounds = layer.bounds
    ctx.setFillColor(paper)
    ctx.fill(bounds)
    drawPDF(page, in: bounds, ctx: ctx)
  }
}

/// Paper for a sketch: blank, lined, grid or dotted, lined up with the page's ruling.
final class RulingView: UIView {
  override class var layerClass: AnyClass { CATiledLayer.self }

  nonisolated private let ruling: Ruling?
  nonisolated private let paper: CGColor
  nonisolated private let line: CGColor

  init(size: CGSize, ruling: Ruling?, dark: Bool) {
    self.ruling = ruling
    let paper: UIColor = dark ? UIColor(red: 0.11, green: 0.11, blue: 0.118, alpha: 1) : .white
    self.paper = paper.cgColor
    line = (dark ? UIColor(red: 0.23, green: 0.23, blue: 0.25, alpha: 1) : UIColor(red: 0.83, green: 0.86, blue: 0.91, alpha: 1)).cgColor
    super.init(frame: CGRect(origin: .zero, size: size))
    configureTiles(layer as! CATiledLayer)
    backgroundColor = paper
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError() }

  override func draw(_ rect: CGRect) {}

  nonisolated override func draw(_ layer: CALayer, in ctx: CGContext) {
    let bounds = layer.bounds
    ctx.setFillColor(paper)
    ctx.fill(ctx.boundingBoxOfClipPath)
    guard let ruling, ruling.template != "blank" else { return }
    let rows = RulingLines.positions(offset: ruling.offsetY, pitch: ruling.pitch, extent: Double(bounds.height))
    let cols = RulingLines.positions(offset: ruling.offsetX, pitch: ruling.pitch, extent: Double(bounds.width))
    ctx.setStrokeColor(line)
    ctx.setFillColor(line)
    ctx.setLineWidth(0.5)
    if ruling.template == "dotted" {
      for y in rows {
        for x in cols {
          ctx.fillEllipse(in: CGRect(x: x - 0.85, y: y - 0.85, width: 1.7, height: 1.7))
        }
      }
      return
    }
    for y in rows {
      ctx.move(to: CGPoint(x: 0, y: y))
      ctx.addLine(to: CGPoint(x: Double(bounds.width), y: y))
    }
    if ruling.template == "grid" {
      for x in cols {
        ctx.move(to: CGPoint(x: x, y: 0))
        ctx.addLine(to: CGPoint(x: x, y: Double(bounds.height)))
      }
    }
    ctx.strokePath()
  }
}

/// A PDF page as a sketch background (drawing on slides).
final class PDFBackgroundView: UIView {
  override class var layerClass: AnyClass { CATiledLayer.self }
  nonisolated(unsafe) private let page: CGPDFPage

  init(page: CGPDFPage, size: CGSize) {
    self.page = page
    super.init(frame: CGRect(origin: .zero, size: size))
    configureTiles(layer as! CATiledLayer)
    backgroundColor = .white
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError() }

  override func draw(_ rect: CGRect) {}

  nonisolated override func draw(_ layer: CALayer, in ctx: CGContext) {
    let bounds = layer.bounds
    ctx.setFillColor(CGColor(gray: 1, alpha: 1))
    ctx.fill(bounds)
    drawPDF(page, in: bounds, ctx: ctx)
  }
}

/// Draws a PDF page scaled into `bounds` (UIKit's flipped coordinates).
private func drawPDF(_ page: CGPDFPage, in bounds: CGRect, ctx: CGContext) {
  let box = page.getBoxRect(.mediaBox)
  guard box.width > 0, box.height > 0 else { return }
  ctx.saveGState()
  ctx.translateBy(x: 0, y: bounds.height)
  ctx.scaleBy(x: bounds.width / box.width, y: -bounds.height / box.height)
  ctx.translateBy(x: -box.minX, y: -box.minY)
  ctx.interpolationQuality = .high
  ctx.drawPDFPage(page)
  ctx.restoreGState()
}

private func configureTiles(_ layer: CATiledLayer) {
  layer.tileSize = CGSize(width: 512, height: 512)
  layer.levelsOfDetail = 4
  layer.levelsOfDetailBias = 5
}
