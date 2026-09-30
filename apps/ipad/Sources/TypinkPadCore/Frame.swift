// Binary frames: [u32 big-endian header length][header JSON][payload].

import Foundation

public enum FrameError: Error, Equatable {
  case tooShort
  case badHeaderLength
  case rangeOutsidePayload
}

public struct Frame: Sendable {
  public var header: Data
  public var payload: Data

  public init(header: Data, payload: Data) {
    self.header = header
    self.payload = payload
  }

  public static func decode(_ data: Data) throws -> Frame {
    guard data.count >= 4 else { throw FrameError.tooShort }
    let bytes = [UInt8](data.prefix(4))
    let length = Int(UInt32(bytes[0]) << 24 | UInt32(bytes[1]) << 16 | UInt32(bytes[2]) << 8 | UInt32(bytes[3]))
    guard length <= data.count - 4 else { throw FrameError.badHeaderLength }
    let start = data.startIndex
    return Frame(
      header: data.subdata(in: (start + 4)..<(start + 4 + length)),
      payload: data.subdata(in: (start + 4 + length)..<data.endIndex)
    )
  }

  public func encoded() -> Data {
    var out = Data(capacity: 4 + header.count + payload.count)
    let n = UInt32(header.count)
    out.append(contentsOf: [UInt8(n >> 24 & 0xff), UInt8(n >> 16 & 0xff), UInt8(n >> 8 & 0xff), UInt8(n & 0xff)])
    out.append(header)
    out.append(payload)
    return out
  }

  /// Bytes of a named part of the payload.
  public func part(_ range: ByteRange?) throws -> Data? {
    guard let range else { return nil }
    guard range.offset >= 0, range.length >= 0, range.offset + range.length <= payload.count else {
      throw FrameError.rangeOutsidePayload
    }
    let start = payload.startIndex + range.offset
    return payload.subdata(in: start..<(start + range.length))
  }
}

/// Concatenates blobs into one payload and reports where each one landed.
public struct PayloadBuilder {
  public private(set) var payload = Data()

  public init() {}

  public mutating func append(_ blob: Data) -> ByteRange {
    let range = ByteRange(offset: payload.count, length: blob.count)
    payload.append(blob)
    return range
  }
}
