// PencilKit strokes → the vector form the Mac renders (docs/protocol.md, "render").

import CoreGraphics
import Foundation
import PencilKit

public enum StrokeRender {
  /// Sample spacing along a stroke, in stroke units (pt).
  public static let sampleDistance: CGFloat = 1.5

  /// Converts every stroke of a drawing. `transform` is applied after each stroke's own transform.
  public static func render(
    _ drawing: PKDrawing,
    transform: CGAffineTransform = .identity,
    darkColor: (CGColor) -> CGColor
  ) -> [RenderStroke] {
    drawing.strokes.flatMap { segments(of: $0, transform: transform, darkColor: darkColor) }
  }

  /// One render stroke per visible (unerased) part of `stroke`.
  public static func segments(
    of stroke: PKStroke,
    transform: CGAffineTransform = .identity,
    darkColor: (CGColor) -> CGColor
  ) -> [RenderStroke] {
    let ink = stroke.ink
    let name = inkName(ink.inkType)
    let color = ink.color.cgColor
    let light = hex(color)
    let dark = hex(darkColor(color))
    let combined = stroke.transform.concatenating(transform)
    let scale = sqrt(abs(Double(combined.a * combined.d - combined.b * combined.c)))
    let directional = name == "fountainPen" || name == "marker"

    let ranges: [ClosedRange<CGFloat>?] = stroke.mask == nil ? [nil] : stroke.maskedPathRanges.map { Optional($0) }
    var out: [RenderStroke] = []
    for range in ranges {
      let samples = Array(stroke.path.interpolatedPoints(in: range, by: .distance(sampleDistance)))
      if samples.isEmpty { continue }
      var points: [Double] = []
      points.reserveCapacity(samples.count * 4)
      for (i, p) in samples.enumerated() {
        let at = p.location.applying(combined)
        var width = Double(p.size.width)
        if directional, samples.count > 1 {
          // A chisel/nib tip: its width across the stroke depends on the direction of travel.
          let a = samples[max(0, i - 1)].location
          let b = samples[min(samples.count - 1, i + 1)].location
          let travel = atan2(Double(b.y - a.y), Double(b.x - a.x))
          let delta = travel - Double(p.azimuth)
          width = hypot(Double(p.size.width) * sin(delta), Double(p.size.height) * cos(delta))
        }
        points.append(round2(Double(at.x)))
        points.append(round2(Double(at.y)))
        points.append(round2(max(0.3, width * scale)))
        points.append(round2(Double(p.opacity)))
      }
      out.append(RenderStroke(ink: name, color: light, colorDark: dark, points: points))
    }
    return out
  }

  public static func inkName(_ type: PKInk.InkType) -> String {
    switch type {
    case .pen: return "pen"
    case .pencil: return "pencil"
    case .marker: return "marker"
    case .monoline: return "monoline"
    case .fountainPen: return "fountainPen"
    default: return "other"
    }
  }

  /// `#rrggbbaa` in sRGB.
  public static func hex(_ color: CGColor) -> String {
    let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
    let c = color.converted(to: srgb, intent: .defaultIntent, options: nil) ?? color
    let comps = c.components ?? [0, 0, 0, 1]
    let rgba: [CGFloat] =
      comps.count >= 4 ? Array(comps.prefix(4)) : comps.count == 2 ? [comps[0], comps[0], comps[0], comps[1]] : [0, 0, 0, 1]
    return "#" + rgba.map { String(format: "%02x", Int((min(max($0, 0), 1) * 255).rounded())) }.joined()
  }

  private static func round2(_ v: Double) -> Double {
    (v * 100).rounded() / 100
  }
}
