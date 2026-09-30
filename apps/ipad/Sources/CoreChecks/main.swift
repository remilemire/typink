// `swift run core-checks`: exercises TypinkPadCore without XCTest, so it runs with
// just the Command Line Tools. The XCTest suite covers the same ground in Xcode.

import CoreGraphics
import Foundation
import PencilKit
import TypinkPadCore

var failures = 0

@MainActor func check(_ condition: @autoclosure () throws -> Bool, _ message: String, file: String = #fileID, line: Int = #line) {
  do {
    if try condition() {
      print("  ✓ \(message)")
      return
    }
    print("  ✗ \(message) (\(file):\(line))")
  } catch {
    print("  ✗ \(message): \(error) (\(file):\(line))")
  }
  failures += 1
}

let fixtures = URL(fileURLWithPath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .appendingPathComponent("../../packages/protocol/fixtures").standardizedFileURL

print("Protocol fixtures (Mac → iPad)")
for file in try FileManager.default.contentsOfDirectory(atPath: fixtures.appendingPathComponent("toPad").path).sorted() {
  let data = try Data(contentsOf: fixtures.appendingPathComponent("toPad/\(file)"))
  let decoded = try ToPad.decode(data)
  var known = true
  if case .unknown = decoded { known = false }
  check(known, "decodes \(file)")
}

print("Protocol messages (iPad → Mac)")
@MainActor func type(of json: Data) throws -> String {
  (try JSONSerialization.jsonObject(with: json) as? [String: Any])?["t"] as? String ?? ""
}
let fromPad: [(FromPad, String)] = [
  (.hello(deviceId: UUID().uuidString, name: "iPad", token: nil, appearance: .light), "hello"),
  (.pair(code: "123456"), "pair"),
  (.listNotes, "listNotes"),
  (.view(note: nil, theme: .dark), "view"),
  (.sketchNew, "sketchNew"),
  (.sketchRequest(id: "s1"), "sketchRequest"),
  (.sketchPut(id: "s1", rev: 2, size: Size(w: 10, h: 10), render: [], pk: ByteRange(offset: 0, length: 3)), "sketchPut"),
  (.sketchClose(id: "s1"), "sketchClose"),
  (.annotatePut(note: "a.typ", viewedRev: 1, pages: [1], clusters: []), "annotatePut"),
  (.image(name: "x.jpg", mime: "image/jpeg", mode: "insert", data: ByteRange(offset: 0, length: 1)), "image"),
]
for (message, expected) in fromPad {
  check(try type(of: message.encode()) == expected, "encodes \(expected)")
}
let view = try JSONSerialization.jsonObject(with: FromPad.view(note: nil, theme: .light).encode()) as! [String: Any]
check(view.keys.contains("note") && view["note"] is NSNull, "view encodes a null note when following the Mac")

print("Binary frames")
var builder = PayloadBuilder()
let pkRange = builder.append(Data([1, 2, 3]))
let bgRange = builder.append(Data([9, 8]))
let frame = Frame(header: Data("{\"t\":\"x\"}".utf8), payload: builder.payload)
let decoded = try Frame.decode(frame.encoded())
check(decoded.header == frame.header, "header round-trips")
check(try decoded.part(pkRange) == Data([1, 2, 3]) && decoded.part(bgRange) == Data([9, 8]), "parts round-trip")
check((try? decoded.part(ByteRange(offset: 4, length: 9))) == nil, "rejects ranges outside the payload")
check((try? Frame.decode(Data([0, 0, 0, 9, 1]))) == nil, "rejects truncated frames")

print("Stroke conversion")
func stroke(_ points: [CGPoint], width: CGFloat = 2, ink: PKInk.InkType = .pen) -> PKStroke {
  let controls = points.enumerated().map { i, p in
    PKStrokePoint(location: p, timeOffset: Double(i) * 0.01, size: CGSize(width: width, height: width), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
  }
  return PKStroke(ink: PKInk(ink, color: .black), path: PKStrokePath(controlPoints: controls, creationDate: Date()))
}
let line = stroke((0...10).map { CGPoint(x: CGFloat($0) * 10, y: 20) })
let rendered = StrokeRender.segments(of: line, darkColor: { _ in CGColor(gray: 1, alpha: 1) })
check(rendered.count == 1, "one segment for an unerased stroke")
check(rendered[0].points.count % 4 == 0 && rendered[0].points.count >= 40, "samples along the stroke (\(rendered[0].points.count / 4))")
check(rendered[0].color == "#000000ff" && rendered[0].colorDark == "#ffffffff", "light and dark colours")
let moved = StrokeRender.segments(of: line, transform: CGAffineTransform(translationX: 100, y: 5), darkColor: { $0 })
check(abs(moved[0].points[0] - rendered[0].points[0] - 100) < 0.01 && abs(moved[0].points[1] - rendered[0].points[1] - 5) < 0.01, "applies the extra transform")
let doubled = StrokeRender.segments(of: line, transform: CGAffineTransform(scaleX: 2, y: 2), darkColor: { $0 })
check(abs(doubled[0].points[2] - 2 * rendered[0].points[2]) < 0.05, "scales widths with the transform")
check(StrokeRender.inkName(.marker) == "marker" && StrokeRender.inkName(.fountainPen) == "fountainPen", "ink names")

print("Clustering")
let layout = DocumentLayout(pages: [CGSize(width: 595, height: 842), CGSize(width: 595, height: 842)])
check(layout.pageFrames[1].minY == 842 + DocumentLayout.gap, "pages stack with a gap")
let word = [stroke([CGPoint(x: 100, y: 100), CGPoint(x: 110, y: 90)]), stroke([CGPoint(x: 115, y: 100), CGPoint(x: 125, y: 92)])]
let farAway = stroke([CGPoint(x: 400, y: 600), CGPoint(x: 450, y: 610)])
let onPage2 = stroke([CGPoint(x: 100, y: 842 + DocumentLayout.gap + 50), CGPoint(x: 150, y: 842 + DocumentLayout.gap + 60)])
let clusters = Clusterer.clusters(of: word + [farAway, onPage2], layout: layout)
check(clusters.count == 3, "nearby strokes form one cluster (\(clusters.count) clusters)")
check(clusters.map(\.page) == [1, 1, 2], "clusters know their page")
check(abs(clusters[2].bbox.minY - 50) < 3, "bbox is in page coordinates")
let local = clusters[0].strokes.map(\.renderBounds).reduce(CGRect.null) { $0.union($1) }
check(abs(local.minX) < 0.5 && abs(local.minY) < 0.5, "cluster strokes are local to the bbox")
let placed = Clusterer.place(PKDrawing(strokes: clusters[2].strokes), page: 2, x: clusters[2].bbox.minX, y: clusters[2].bbox.minY, layout: layout)
let back = placed.map(\.renderBounds).reduce(CGRect.null) { $0.union($1) }
check(abs(back.minY - onPage2.renderBounds.minY) < 0.5, "placing a cluster puts it back where it was drawn")

print("Ruling and pairing link")
check(RulingLines.positions(offset: 13.86, pitch: 19.25, extent: 60) == [13.86, 33.11, 52.36], "rule positions")
check(RulingLines.positions(offset: -5.39, pitch: 19.25, extent: 30).first.map { abs($0 - 13.86) < 0.001 } == true, "negative offsets wrap")
let link = PairingLink("typink://pair?host=MacBook-Air.local&ip=192.168.1.5,10.0.0.2&port=47321&code=042317")
check(link?.addresses == ["192.168.1.5", "10.0.0.2"] && link?.port == 47321 && link?.code == "042317", "parses the pairing QR link")
check(PairingLink("https://example.com") == nil && PairingLink("typink://pair?port=1&code=12") == nil, "rejects other links")

print("Outbox")
var outbox = Outbox<Int>()
outbox.put("s1", 1)
check(!outbox.isEmpty && outbox.items["s1"] == 1, "keeps what hasn't been sent (the Mac is unreachable)")
outbox.sent("s1")
outbox.put("s1", 2)
outbox.sent("s1")
outbox.acknowledged("s1")
check(outbox.items["s1"] == 2, "an older put's ack doesn't clear a newer one")
outbox.acknowledged("s1")
check(outbox.isEmpty, "cleared once every put is acknowledged")
outbox.put("s2", 3)
outbox.sent("s2")
outbox.connectionLost()
check(outbox.items["s2"] == 3, "puts on a lost connection are kept for resending")
outbox.sent("s2")
outbox.acknowledged("s2")
check(outbox.isEmpty, "resent put acknowledged")

print(failures == 0 ? "\nAll checks passed." : "\n\(failures) check(s) failed.")
exit(failures == 0 ? 0 : 1)
