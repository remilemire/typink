// A WebSocket connection to the Mac over Network.framework.

import Foundation
import Network
import TypinkPadCore

@MainActor
final class HubConnection {
  enum Event {
    case ready
    /// A message; binary frames also carry their payload.
    case message(ToPad, Frame?)
    case closed(String?)
  }

  var onEvent: ((Event) -> Void)?
  private let target: NWEndpoint
  private var connection: NWConnection?
  private var probe: NWConnection?
  private var closed = false
  private var ready = false
  private var timeout: Task<Void, Never>?

  init(endpoint: NWEndpoint) {
    target = endpoint
  }

  func start() {
    // A firewall that silently holds the connection would otherwise leave us waiting forever.
    timeout = Task { [weak self] in
      try? await Task.sleep(for: .seconds(12))
      guard let self, !Task.isCancelled, !self.ready else { return }
      self.finish("timed out")
    }
    if case .service = target {
      resolveThenConnect()
    } else {
      connect(to: target)
    }
  }

  /// A WebSocket to a Bonjour *service* endpoint never completes its handshake, so
  /// first open a plain TCP connection to learn the Mac's address, then connect there.
  private func resolveThenConnect() {
    let probe = NWConnection(to: target, using: .tcp)
    self.probe = probe
    probe.stateUpdateHandler = { [weak self, weak probe] state in
      Task { @MainActor in
        guard let self, let probe, !self.closed else { return }
        switch state {
        case .ready:
          let remote = probe.currentPath?.remoteEndpoint
          probe.cancel()
          self.probe = nil
          if let url = remote.flatMap(Self.websocketURL) {
            self.connect(to: .url(url))
          } else {
            self.finish("couldn't find the Mac's address")
          }
        case let .failed(error), let .waiting(error):
          probe.cancel()
          self.probe = nil
          self.finish(error.localizedDescription)
        default:
          break
        }
      }
    }
    probe.start(queue: .main)
  }

  /// ws://host:port/ for a resolved address. The WebSocket client only sends a
  /// valid upgrade request (with a path) for URL endpoints.
  nonisolated static func websocketURL(_ endpoint: NWEndpoint) -> URL? {
    guard case let .hostPort(host, port) = endpoint else { return nil }
    let name: String
    switch host {
    case let .ipv4(address):
      // Resolved addresses carry an interface scope ("…%en0") that IPv4 URLs can't hold.
      name = "\(address)".components(separatedBy: "%")[0]
    case let .ipv6(address):
      name = "[\("\(address)".replacingOccurrences(of: "%", with: "%25"))]"
    case let .name(hostname, _):
      name = hostname
    @unknown default:
      return nil
    }
    return URL(string: "ws://\(name):\(port.rawValue)/")
  }

  private func connect(to endpoint: NWEndpoint) {
    // A Mac that sleeps or leaves the Wi-Fi never closes the connection; notice within
    // ~20 s (idle, or with ink waiting to be acknowledged) instead of minutes.
    let tcp = NWProtocolTCP.Options()
    tcp.enableKeepalive = true
    tcp.keepaliveIdle = 10
    tcp.keepaliveInterval = 5
    tcp.keepaliveCount = 2
    tcp.connectionDropTime = 20
    let parameters = NWParameters(tls: nil, tcp: tcp)
    let websocket = NWProtocolWebSocket.Options()
    websocket.autoReplyPing = true
    websocket.maximumMessageSize = 64 * 1024 * 1024
    parameters.defaultProtocolStack.applicationProtocols.insert(websocket, at: 0)
    let connection = NWConnection(to: endpoint, using: parameters)
    self.connection = connection
    connection.stateUpdateHandler = { [weak self] state in
      Task { @MainActor in self?.stateChanged(state) }
    }
    connection.start(queue: .main)
    receive()
  }

  func cancel() {
    closed = true
    timeout?.cancel()
    probe?.cancel()
    connection?.cancel()
  }

  func send(_ message: FromPad) {
    guard let json = try? message.encode() else { return }
    send(json, opcode: .text)
  }

  func send(_ message: FromPad, payload: Data) {
    guard let json = try? message.encode() else { return }
    send(Frame(header: json, payload: payload).encoded(), opcode: .binary)
  }

  private func send(_ data: Data, opcode: NWProtocolWebSocket.Opcode) {
    let metadata = NWProtocolWebSocket.Metadata(opcode: opcode)
    let context = NWConnection.ContentContext(identifier: "message", metadata: [metadata])
    connection?.send(content: data, contentContext: context, isComplete: true, completion: .contentProcessed { _ in })
  }

  private func stateChanged(_ state: NWConnection.State) {
    switch state {
    case .ready:
      ready = true
      timeout?.cancel()
      onEvent?(.ready)
    case let .failed(error):
      finish(error.localizedDescription)
    case let .waiting(error):
      finish(error.localizedDescription)
    case .cancelled:
      finish(nil)
    default:
      break
    }
  }

  private func finish(_ reason: String?) {
    guard !closed else { return }
    closed = true
    timeout?.cancel()
    probe?.cancel()
    connection?.cancel()
    onEvent?(.closed(reason))
  }

  private func receive() {
    connection?.receiveMessage { [weak self] data, context, _, error in
      Task { @MainActor in
        guard let self else { return }
        if let error {
          self.finish(error.localizedDescription)
          return
        }
        if let data, let context,
          let metadata = context.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata
        {
          self.handle(data, opcode: metadata.opcode)
        }
        if !self.closed { self.receive() }
      }
    }
  }

  private func handle(_ data: Data, opcode: NWProtocolWebSocket.Opcode) {
    do {
      switch opcode {
      case .text:
        onEvent?(.message(try ToPad.decode(data), nil))
      case .binary:
        let frame = try Frame.decode(data)
        onEvent?(.message(try ToPad.decode(frame.header), frame))
      case .close:
        finish(nil)
      default:
        break
      }
    } catch {
      Log.hub.error("Could not decode a message from the Mac: \(error.localizedDescription, privacy: .public)")
    }
  }
}
