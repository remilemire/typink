import CoreGraphics
import Foundation
import PencilKit
import XCTest
@testable import TypinkPadCore

final class CoreTests: XCTestCase {
  private var fixtures: URL {
    URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("../../packages/protocol/fixtures").standardizedFileURL
  }

  func testDecodesEveryMacMessageFixture() throws {
    let dir = fixtures.appendingPathComponent("toPad")
    for file in try FileManager.default.contentsOfDirectory(atPath: dir.path) {
      let message = try ToPad.decode(Data(contentsOf: dir.appendingPathComponent(file)))
      if case .unknown(let t) = message { XCTFail("\(file) decoded as unknown type \(t)") }
    }
  }

  func testFramesRoundTrip() throws {
    var builder = PayloadBuilder()
    let range = builder.append(Data([1, 2, 3]))
    let frame = Frame(header: Data("{\"t\":\"pdf\"}".utf8), payload: builder.payload)
    let decoded = try Frame.decode(frame.encoded())
    XCTAssertEqual(decoded.header, frame.header)
    XCTAssertEqual(try decoded.part(range), Data([1, 2, 3]))
    XCTAssertThrowsError(try decoded.part(ByteRange(offset: 2, length: 5)))
  }

  func testStrokeConversionAppliesTransforms() {
    let points = (0...10).map {
      PKStrokePoint(location: CGPoint(x: CGFloat($0) * 10, y: 0), timeOffset: 0, size: CGSize(width: 2, height: 2), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
    }
    let stroke = PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: points, creationDate: Date()))
    let plain = StrokeRender.segments(of: stroke, darkColor: { $0 })
    let moved = StrokeRender.segments(of: stroke, transform: CGAffineTransform(translationX: 50, y: 0), darkColor: { $0 })
    XCTAssertEqual(plain.count, 1)
    XCTAssertEqual(moved[0].points[0] - plain[0].points[0], 50, accuracy: 0.01)
  }

  func testRulingPositions() {
    XCTAssertEqual(RulingLines.positions(offset: 13.86, pitch: 19.25, extent: 60), [13.86, 33.11, 52.36])
  }

  func testPairingLink() {
    let link = PairingLink("typink://pair?host=Mac.local&ip=10.0.0.2&port=47321&code=000123")
    XCTAssertEqual(link?.addresses, ["10.0.0.2"])
    XCTAssertEqual(link?.code, "000123")
  }
}
