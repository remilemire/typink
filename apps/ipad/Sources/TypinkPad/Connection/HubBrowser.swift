// Finds Macs running Typink on the local network (Bonjour `_typink._tcp`).

import Foundation
import Network
import TypinkPadCore

struct DiscoveredMac: Identifiable, Hashable {
  let name: String
  let endpoint: NWEndpoint
  var id: String { name }
}

@MainActor
final class HubBrowser {
  var onChange: (([DiscoveredMac]) -> Void)?
  /// Local network access was refused (Settings › Privacy & Security › Local Network).
  var onDenied: (() -> Void)?

  private var browser: NWBrowser?

  func start() {
    stop()
    let parameters = NWParameters()
    parameters.includePeerToPeer = false
    let browser = NWBrowser(for: .bonjour(type: serviceType, domain: nil), using: parameters)
    browser.browseResultsChangedHandler = { [weak self] results, _ in
      let macs = results.compactMap { result -> DiscoveredMac? in
        guard case let .service(name, _, _, _) = result.endpoint else { return nil }
        return DiscoveredMac(name: name, endpoint: result.endpoint)
      }
      .sorted { $0.name < $1.name }
      Task { @MainActor in self?.onChange?(macs) }
    }
    browser.stateUpdateHandler = { [weak self] state in
      guard case let .failed(error) = state else {
        if case let .waiting(error) = state, Self.isPolicyDenied(error) {
          Task { @MainActor in self?.onDenied?() }
        }
        return
      }
      Task { @MainActor in
        if Self.isPolicyDenied(error) { self?.onDenied?() }
        // Retry after a moment (e.g. Wi-Fi came back).
        try? await Task.sleep(for: .seconds(3))
        self?.start()
      }
    }
    browser.start(queue: .main)
    self.browser = browser
  }

  func stop() {
    browser?.cancel()
    browser = nil
  }

  nonisolated private static func isPolicyDenied(_ error: NWError) -> Bool {
    if case let .dns(code) = error { return code == -65570 } // kDNSServiceErr_PolicyDenied
    return false
  }
}
