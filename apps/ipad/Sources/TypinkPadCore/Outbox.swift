// Changes the Mac hasn't confirmed yet: the latest one per key (a sketch id or a note path).
//
// Every put carries the full state, so only the newest item per key matters. It stays here
// until the Mac has acknowledged every put sent for that key, and whatever is left is sent
// again after reconnecting. A Mac that quits, sleeps or drops off the Wi-Fi mid-drawing never
// loses ink.

public struct Outbox<Item> {
  public private(set) var items: [String: Item] = [:]
  private var inFlight: [String: Int] = [:]

  public init() {}

  public var isEmpty: Bool { items.isEmpty }

  /// Records the newest state for `key` (replacing an older unconfirmed one).
  public mutating func put(_ key: String, _ item: Item) {
    items[key] = item
  }

  /// A put for `key` went out on the current connection.
  public mutating func sent(_ key: String) {
    inFlight[key, default: 0] += 1
  }

  /// The Mac confirmed one put for `key`. Once every put sent is confirmed, the Mac has the newest state.
  public mutating func acknowledged(_ key: String) {
    let left = (inFlight[key] ?? 0) - 1
    if left > 0 {
      inFlight[key] = left
    } else {
      inFlight[key] = nil
      items[key] = nil
    }
  }

  /// Puts on a closed connection may never have arrived; their items are sent again.
  public mutating func connectionLost() {
    inFlight = [:]
  }
}
