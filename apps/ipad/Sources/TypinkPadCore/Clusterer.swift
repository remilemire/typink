// Groups annotation strokes that belong together (overlapping or close bounds on
// the same page). The Mac anchors each group to the text it was drawn on, so a
// handwritten word or a circle around a sentence moves as one piece.

import CoreGraphics
import PencilKit

public struct StrokeCluster {
  public var page: Int
  /// Bounds in page coordinates (pt).
  public var bbox: CGRect
  /// Strokes translated so the cluster's top-left is the origin.
  public var strokes: [PKStroke]
}

public enum Clusterer {
  public static func clusters(of strokes: [PKStroke], layout: DocumentLayout, padding: CGFloat = 14) -> [StrokeCluster] {
    guard !strokes.isEmpty, !layout.pageFrames.isEmpty else { return [] }
    let bounds = strokes.map(\.renderBounds)
    let pages = bounds.map { layout.nearestPage(to: CGPoint(x: $0.midX, y: $0.midY)) }

    // Union-find over strokes on the same page whose padded bounds overlap.
    var parent = Array(strokes.indices)
    func find(_ i: Int) -> Int {
      var i = i
      while parent[i] != i {
        parent[i] = parent[parent[i]]
        i = parent[i]
      }
      return i
    }
    let padded = bounds.map { $0.insetBy(dx: -padding, dy: -padding) }
    for i in strokes.indices {
      for j in strokes.indices where j > i && pages[i] == pages[j] && padded[i].intersects(padded[j]) {
        parent[find(i)] = find(j)
      }
    }

    var groups: [Int: [Int]] = [:]
    for i in strokes.indices { groups[find(i), default: []].append(i) }

    var out: [StrokeCluster] = []
    for members in groups.values {
      let page = pages[members[0]]
      let frame = layout.pageFrames[page]
      let box = members.dropFirst().reduce(bounds[members[0]]) { $0.union(bounds[$1]) }
      let toLocal = CGAffineTransform(translationX: -box.minX, y: -box.minY)
      let local: [PKStroke] = members.map {
        var s = strokes[$0]
        s.transform = s.transform.concatenating(toLocal)
        return s
      }
      out.append(StrokeCluster(page: page + 1, bbox: box.offsetBy(dx: -frame.minX, dy: -frame.minY), strokes: local))
    }
    return out.sorted { ($0.page, $0.bbox.minY, $0.bbox.minX) < ($1.page, $1.bbox.minY, $1.bbox.minX) }
  }

  /// Places a cluster from the Mac back on the canvas.
  public static func place(_ drawing: PKDrawing, page: Int, x: CGFloat, y: CGFloat, layout: DocumentLayout) -> [PKStroke] {
    guard page >= 1, page <= layout.pageFrames.count else { return [] }
    let frame = layout.pageFrames[page - 1]
    let move = CGAffineTransform(translationX: frame.minX + x, y: frame.minY + y)
    return drawing.strokes.map {
      var s = $0
      s.transform = s.transform.concatenating(move)
      return s
    }
  }
}
