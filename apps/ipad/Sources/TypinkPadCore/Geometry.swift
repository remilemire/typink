// Page layout on the canvas, ruling lines, and the pairing QR link.

import CoreGraphics
import Foundation

/// Pages stacked vertically on one canvas (canvas units = pt).
public struct DocumentLayout: Equatable, Sendable {
  public static let gap: CGFloat = 18

  public var pageFrames: [CGRect]
  public var size: CGSize

  public init(pages: [CGSize], gap: CGFloat = DocumentLayout.gap) {
    let width = pages.map(\.width).max() ?? 0
    var y: CGFloat = 0
    var frames: [CGRect] = []
    for page in pages {
      frames.append(CGRect(x: (width - page.width) / 2, y: y, width: page.width, height: page.height))
      y += page.height + gap
    }
    pageFrames = frames
    size = CGSize(width: width, height: max(0, y - gap))
  }

  /// 0-based index of the page containing `point`, or the vertically closest one.
  public func nearestPage(to point: CGPoint) -> Int {
    if let hit = pageFrames.firstIndex(where: { $0.contains(point) }) { return hit }
    var best = 0
    var bestDistance = CGFloat.infinity
    for (i, f) in pageFrames.enumerated() {
      let d = point.y < f.minY ? f.minY - point.y : point.y > f.maxY ? point.y - f.maxY : 0
      if d < bestDistance {
        best = i
        bestDistance = d
      }
    }
    return best
  }

  /// Canvas point → (1-based page, page-space point).
  public func pagePoint(_ point: CGPoint) -> (page: Int, point: CGPoint)? {
    guard let i = pageFrames.firstIndex(where: { $0.contains(point) }) else { return nil }
    let f = pageFrames[i]
    return (i + 1, CGPoint(x: point.x - f.minX, y: point.y - f.minY))
  }
}

public enum RulingLines {
  /// Coordinates of rule lines inside [0, extent] for lines at `offset + k·pitch`.
  public static func positions(offset: Double, pitch: Double, extent: Double) -> [Double] {
    guard pitch > 0.5, extent > 0 else { return [] }
    var first = offset.truncatingRemainder(dividingBy: pitch)
    if first < 0 { first += pitch }
    return Array(stride(from: first, through: extent, by: pitch))
  }
}

/// `typink://pair?host=<name>.local&ip=<a,b>&port=<port>&code=<6 digits>`
public struct PairingLink: Equatable, Sendable {
  public var host: String
  public var addresses: [String]
  public var port: Int
  public var code: String

  public init?(_ string: String) {
    guard let url = URLComponents(string: string), url.scheme == "typink", url.host == "pair" else { return nil }
    let items = Dictionary((url.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
    guard let port = Int(items["port"] ?? ""), let code = items["code"], code.count == 6, code.allSatisfy(\.isNumber) else {
      return nil
    }
    host = items["host"] ?? ""
    addresses = (items["ip"] ?? "").split(separator: ",").map(String.init).filter { !$0.isEmpty }
    self.port = port
    self.code = code
  }
}
