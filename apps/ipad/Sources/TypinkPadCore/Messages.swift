// Swift mirror of the Typink wire protocol (docs/protocol.md).

import Foundation

public let protocolVersion = 1
public let serviceType = "_typink._tcp"

public enum PaperTheme: String, Codable, Sendable {
  case light, dark
}

/// A byte range `[offset, length]` inside a binary frame's payload.
public struct ByteRange: Codable, Sendable, Equatable {
  public var offset: Int
  public var length: Int

  public init(offset: Int, length: Int) {
    self.offset = offset
    self.length = length
  }

  public init(from decoder: Decoder) throws {
    var c = try decoder.unkeyedContainer()
    offset = try c.decode(Int.self)
    length = try c.decode(Int.self)
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.unkeyedContainer()
    try c.encode(offset)
    try c.encode(length)
  }
}

public struct Size: Codable, Sendable, Equatable {
  public var w: Double
  public var h: Double

  public init(w: Double, h: Double) {
    self.w = w
    self.h = h
  }
}

public struct Ruling: Codable, Sendable, Equatable {
  public var template: String
  public var pitch: Double
  public var offsetX: Double
  public var offsetY: Double

  public init(template: String, pitch: Double, offsetX: Double, offsetY: Double) {
    self.template = template
    self.pitch = pitch
    self.offsetX = offsetX
    self.offsetY = offsetY
  }
}

public struct RenderStroke: Codable, Sendable, Equatable {
  public var ink: String
  public var color: String
  public var colorDark: String
  /// Flattened [x, y, width, opacity] samples.
  public var points: [Double]

  public init(ink: String, color: String, colorDark: String, points: [Double]) {
    self.ink = ink
    self.color = color
    self.colorDark = colorDark
    self.points = points
  }
}

public struct SketchPlacement: Codable, Sendable, Equatable, Identifiable {
  public var id: String
  public var page: Int
  public var x: Double
  public var y: Double
  public var w: Double
  public var h: Double
  public var on: String?
}

public struct NoteSummary: Codable, Sendable, Equatable, Identifiable {
  public var path: String
  public var name: String
  public var folder: String
  public var mtime: Double
  public var id: String { path }
}

// MARK: - Mac → iPad

public struct Welcome: Codable, Sendable { public var proto: Int; public var macName: String }
public struct PairNeeded: Codable, Sendable { public var macName: String }
public struct Paired: Codable, Sendable { public var token: String }
public struct PairFailed: Codable, Sendable { public var reason: String }
public struct NotesList: Codable, Sendable { public var notes: [NoteSummary]; public var active: String? }

public struct NoteInfo: Codable, Sendable, Equatable {
  public var note: String
  public var title: String
  public var rev: Int
  public var following: Bool
  public var pages: [Size]
  public var sketches: [SketchPlacement]
  public var ruling: Ruling?
}

public struct PDFHeader: Codable, Sendable {
  public struct Parts: Codable, Sendable { public var data: ByteRange }
  public var note: String
  public var rev: Int
  public var theme: PaperTheme
  public var parts: Parts
}

public struct AnnotationCluster: Codable, Sendable, Equatable {
  public var id: String
  public var page: Int
  public var x: Double
  public var y: Double
  public var w: Double
  public var h: Double
  public var pk: ByteRange
}

public struct AnnotationsHeader: Codable, Sendable {
  public var note: String
  public var rev: Int
  public var clusters: [AnnotationCluster]
}

public struct SketchOpenHeader: Codable, Sendable {
  public struct Background: Codable, Sendable, Equatable {
    public var path: String
    public var mime: String
    public var page: Int?
  }

  public struct Parts: Codable, Sendable {
    public var pk: ByteRange?
    public var background: ByteRange?
  }

  public var note: String
  public var id: String
  public var rev: Int
  public var size: Size
  public var ruling: Ruling?
  public var background: Background?
  public var parts: Parts
}

public struct SketchAck: Codable, Sendable { public var id: String; public var rev: Int }
public struct AnnotateAck: Codable, Sendable { public var note: String }
public struct Toast: Codable, Sendable { public var message: String }

public enum ToPad: Sendable {
  case welcome(Welcome)
  case pairNeeded(PairNeeded)
  case paired(Paired)
  case pairFailed(PairFailed)
  case notes(NotesList)
  case note(NoteInfo)
  case pdf(PDFHeader)
  case annotations(AnnotationsHeader)
  case sketchOpen(SketchOpenHeader)
  case sketchAck(SketchAck)
  case annotateAck(AnnotateAck)
  case toast(Toast)
  case unknown(String)

  private struct Probe: Decodable { var t: String }

  /// Decodes a message header (a text frame, or the JSON part of a binary frame).
  public static func decode(_ json: Data) throws -> ToPad {
    let d = JSONDecoder()
    let type = try d.decode(Probe.self, from: json).t
    switch type {
    case "welcome": return .welcome(try d.decode(Welcome.self, from: json))
    case "pairNeeded": return .pairNeeded(try d.decode(PairNeeded.self, from: json))
    case "paired": return .paired(try d.decode(Paired.self, from: json))
    case "pairFailed": return .pairFailed(try d.decode(PairFailed.self, from: json))
    case "notes": return .notes(try d.decode(NotesList.self, from: json))
    case "note": return .note(try d.decode(NoteInfo.self, from: json))
    case "pdf": return .pdf(try d.decode(PDFHeader.self, from: json))
    case "annotations": return .annotations(try d.decode(AnnotationsHeader.self, from: json))
    case "sketchOpen": return .sketchOpen(try d.decode(SketchOpenHeader.self, from: json))
    case "sketchAck": return .sketchAck(try d.decode(SketchAck.self, from: json))
    case "annotateAck": return .annotateAck(try d.decode(AnnotateAck.self, from: json))
    case "toast": return .toast(try d.decode(Toast.self, from: json))
    default: return .unknown(type)
    }
  }
}

// MARK: - iPad → Mac

/// A message the iPad sends; `t` is filled in by `FromPad.encode`.
public enum FromPad: Sendable {
  case hello(deviceId: String, name: String, token: String?, appearance: PaperTheme)
  case pair(code: String)
  case listNotes
  case view(note: String?, theme: PaperTheme)
  case sketchNew
  case sketchRequest(id: String)
  case sketchPut(id: String, rev: Int, size: Size, render: [RenderStroke], pk: ByteRange)
  case sketchClose(id: String)
  case annotatePut(note: String, viewedRev: Int, pages: [Int], clusters: [OutgoingCluster])
  case image(name: String, mime: String, mode: String, data: ByteRange)

  public struct OutgoingCluster: Codable, Sendable {
    public var id: String
    public var page: Int
    /// Page-space [x, y, w, h].
    public var bbox: [Double]
    public var render: [RenderStroke]
    public var pk: ByteRange

    public init(id: String, page: Int, bbox: [Double], render: [RenderStroke], pk: ByteRange) {
      self.id = id
      self.page = page
      self.bbox = bbox
      self.render = render
      self.pk = pk
    }
  }

  private struct Hello: Encodable { let t = "hello"; let proto = protocolVersion; var deviceId: String; var name: String; var token: String?; var appearance: PaperTheme }
  private struct Pair: Encodable { let t = "pair"; var code: String }
  private struct Bare: Encodable { var t: String }
  private struct View: Encodable {
    let t = "view"
    var note: String?
    var theme: PaperTheme
    func encode(to encoder: Encoder) throws {
      var c = encoder.container(keyedBy: CodingKeys.self)
      try c.encode(t, forKey: .t)
      try c.encode(note, forKey: .note) // encodes null when following the Mac
      try c.encode(theme, forKey: .theme)
    }
    enum CodingKeys: String, CodingKey { case t, note, theme }
  }
  private struct IdOnly: Encodable { var t: String; var id: String }
  private struct SketchPut: Encodable {
    struct Parts: Encodable { var pk: ByteRange }
    let t = "sketchPut"
    var id: String
    var rev: Int
    var size: Size
    var render: [RenderStroke]
    var parts: Parts
  }
  private struct AnnotatePut: Encodable {
    let t = "annotatePut"
    var note: String
    var viewedRev: Int
    var pages: [Int]
    var clusters: [OutgoingCluster]
  }
  private struct Image: Encodable {
    struct Parts: Encodable { var data: ByteRange }
    let t = "image"
    var name: String
    var mime: String
    var mode: String
    var parts: Parts
  }

  public func encode() throws -> Data {
    let e = JSONEncoder()
    switch self {
    case let .hello(deviceId, name, token, appearance):
      return try e.encode(Hello(deviceId: deviceId, name: name, token: token, appearance: appearance))
    case let .pair(code):
      return try e.encode(Pair(code: code))
    case .listNotes:
      return try e.encode(Bare(t: "listNotes"))
    case let .view(note, theme):
      return try e.encode(View(note: note, theme: theme))
    case .sketchNew:
      return try e.encode(Bare(t: "sketchNew"))
    case let .sketchRequest(id):
      return try e.encode(IdOnly(t: "sketchRequest", id: id))
    case let .sketchPut(id, rev, size, render, pk):
      return try e.encode(SketchPut(id: id, rev: rev, size: size, render: render, parts: .init(pk: pk)))
    case let .sketchClose(id):
      return try e.encode(IdOnly(t: "sketchClose", id: id))
    case let .annotatePut(note, viewedRev, pages, clusters):
      return try e.encode(AnnotatePut(note: note, viewedRev: viewedRev, pages: pages, clusters: clusters))
    case let .image(name, mime, mode, data):
      return try e.encode(Image(name: name, mime: mime, mode: mode, parts: .init(data: data)))
    }
  }
}
