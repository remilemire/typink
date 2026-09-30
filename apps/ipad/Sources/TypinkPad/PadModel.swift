// All iPad state: the connection to the Mac, the note being shown, handwriting
// on it, and the sketch being edited.

import CoreGraphics
import Foundation
import Network
import Observation
import PencilKit
import SwiftUI
import TypinkPadCore
import UIKit

/// The note PDF as received from the Mac.
struct NotePDF {
  let rev: Int
  let theme: PaperTheme
  let document: CGPDFDocument
}

/// A sketch open in the editor.
struct SketchSession: Identifiable {
  let id: String
  let note: String
  var size: CGSize
  let ruling: Ruling?
  let background: SketchBackground?
  var drawing: PKDrawing
}

enum SketchBackground {
  case image(UIImage)
  case pdf(CGPDFPage)
}

/// The newest state of a sketch, until the Mac confirms it.
private struct SketchUpload {
  let mac: String
  let size: CGSize
  let drawing: PKDrawing
}

/// Handwriting on a note, until the Mac confirms it.
private struct AnnotationUpload {
  let mac: String
  let message: FromPad
  let payload: Data
}

@MainActor
@Observable
final class PadModel {
  enum Phase: Equatable {
    case searching
    case connecting(String)
    case pairing(String)
    case connected(String)
    /// The connection dropped; the note stays on screen while we retry.
    case reconnecting(String)
  }

  // Connection
  var phase: Phase = .searching
  var macs: [DiscoveredMac] = []
  var localNetworkDenied = false
  var pairingError: String?
  var lastError: String?

  // Note
  var notes: [NoteSummary] = []
  var macActiveNote: String?
  var following = true
  var note: NoteInfo?
  var pdf: NotePDF?
  /// Handwriting over the text, positioned for the current `note.rev`.
  var annotationStrokes: [PKStroke] = []
  var annotationVersion = 0
  var annotating = false
  /// The Mac changed the note while annotating; applied when annotating ends.
  var updateWaiting = false

  // Sketch editor
  var sketch: SketchSession?
  var toast: String?
  /// Ink waiting for the Mac (shown while it's out of reach).
  var hasUnsentInk = false

  @ObservationIgnored private let browser = HubBrowser()
  @ObservationIgnored private var connection: HubConnection?
  @ObservationIgnored private var macName: String?
  @ObservationIgnored private var pendingCode: String?
  @ObservationIgnored private var pendingNote: NoteInfo?
  @ObservationIgnored private var pendingPDF: NotePDF?
  @ObservationIgnored private var pendingAnnotations: [PKStroke]?
  @ObservationIgnored private var sketchRev = 0
  @ObservationIgnored private var reconnectTask: Task<Void, Never>?
  @ObservationIgnored private let deviceId: String
  @ObservationIgnored private var lastEndpoint: NWEndpoint?
  // Ink the Mac hasn't confirmed, sent again after reconnecting (by sketch id / note path).
  @ObservationIgnored private var sketchOutbox = Outbox<SketchUpload>()
  @ObservationIgnored private var annotationOutbox = Outbox<AnnotationUpload>()

  var paperTheme: PaperTheme = UITraitCollection.current.userInterfaceStyle == .dark ? .dark : .light

  /// Page frames on the canvas. The PDF's own page boxes are exact, so they win.
  var layout: DocumentLayout {
    if let doc = pdf?.document, doc.numberOfPages > 0 {
      let sizes = (1...doc.numberOfPages).compactMap { doc.page(at: $0)?.getBoxRect(.mediaBox).size }
      return DocumentLayout(pages: sizes)
    }
    return DocumentLayout(pages: (note?.pages ?? []).map { CGSize(width: $0.w, height: $0.h) })
  }

  var connectedMac: String? {
    if case let .connected(name) = phase { return name }
    return nil
  }

  /// The Mac we're connected to, or trying to get back to.
  var macDisplayName: String? {
    switch phase {
    case let .connected(name), let .reconnecting(name): return name
    default: return nil
    }
  }

  var reconnecting: Bool {
    if case .reconnecting = phase { return true }
    return false
  }

  /// The note stays visible while a dropped connection is re-established.
  var showsDocument: Bool {
    connectedMac != nil || (reconnecting && note != nil)
  }

  init() {
    if let id = UserDefaults.standard.string(forKey: "deviceId") {
      deviceId = id
    } else {
      deviceId = UUID().uuidString
      UserDefaults.standard.set(deviceId, forKey: "deviceId")
    }
    browser.onChange = { [weak self] macs in self?.discovered(macs) }
    browser.onDenied = { [weak self] in self?.localNetworkDenied = true }
    browser.start()
  }

  // MARK: - Connecting

  private func discovered(_ macs: [DiscoveredMac]) {
    let appeared = Set(macs.map(\.name)).subtracting(self.macs.map(\.name))
    self.macs = macs
    localNetworkDenied = false
    switch phase {
    case .searching:
      guard connection == nil else { return }
      // Reconnect automatically to a Mac we've paired with before.
      let remembered = UserDefaults.standard.string(forKey: "lastMac")
      if let mac = macs.first(where: { $0.name == remembered && Keychain.token(for: $0.name) != nil })
        ?? macs.first(where: { Keychain.token(for: $0.name) != nil })
      {
        connect(to: mac)
      }
    case let .reconnecting(name):
      // The Mac is back on the network: try right away instead of waiting for the next retry,
      // replacing a retry that may still be stuck on the old address.
      guard let mac = macs.first(where: { $0.name == name }), connection == nil || appeared.contains(name) else { return }
      attempt(mac.endpoint, name: name, quietly: true)
    default:
      break
    }
  }

  func connect(to mac: DiscoveredMac) {
    stopReconnecting()
    attempt(mac.endpoint, name: mac.name, quietly: false)
  }

  /// Manual address or a scanned pairing QR code.
  func connect(host: String, port: Int, code: String? = nil) {
    let host = host.trimmingCharacters(in: .whitespacesAndNewlines)
    // IPv6 addresses need brackets in a URL.
    let urlHost = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
    guard !host.isEmpty, (1...65535).contains(port), let url = URL(string: "ws://\(urlHost):\(port)/"), url.host != nil else {
      lastError = "“\(host)” doesn’t look like an address. Use your Mac’s name, like MacBook-Air.local, or its IP address."
      return
    }
    stopReconnecting()
    pendingCode = code
    attempt(NWEndpoint.url(url), name: host, quietly: false)
  }

  func connect(link: PairingLink) {
    let host = link.addresses.first ?? link.host
    connect(host: host, port: link.port, code: link.code)
  }

  /// Opens a connection. `quietly` keeps the reconnecting state (and the note) on screen.
  private func attempt(_ endpoint: NWEndpoint, name: String, quietly: Bool) {
    connection?.cancel()
    let conn = HubConnection(endpoint: endpoint)
    connection = conn
    lastEndpoint = endpoint
    macName = name
    if !quietly { phase = .connecting(name) }
    pairingError = nil
    conn.onEvent = { [weak self, weak conn] event in
      guard let self, let conn, conn === self.connection else { return }
      self.handle(event)
    }
    conn.start()
  }

  func pair(code: String) {
    pairingError = nil
    connection?.send(.pair(code: code))
  }

  func disconnect(forget: Bool = false) {
    if forget, let name = macName { Keychain.removeToken(for: name) }
    stopReconnecting()
    connection?.cancel()
    connection = nil
    phase = .searching
    note = nil
    pdf = nil
    annotationStrokes = []
    if forget { UserDefaults.standard.removeObject(forKey: "lastMac") }
  }

  private func handle(_ event: HubConnection.Event) {
    switch event {
    case .ready:
      let token = macName.flatMap { Keychain.token(for: $0) }
      connection?.send(.hello(deviceId: deviceId, name: UIDevice.current.name, token: token, appearance: paperTheme))
    case let .message(message, frame):
      handle(message, frame)
    case let .closed(reason):
      connection = nil
      sketchOutbox.connectionLost()
      annotationOutbox.connectionLost()
      switch phase {
      case let .connected(name), let .reconnecting(name):
        phase = .reconnecting(name)
        if reconnectTask == nil { scheduleReconnect(name) }
      default:
        let name = macName ?? "your Mac"
        phase = .searching
        if let reason {
          lastError = reason == "timed out"
            ? "\(name) didn't answer. If your Mac asked whether Typink may accept incoming network connections, choose Allow (System Settings › Network › Firewall)."
            : "Couldn't reach \(name). Check that Typink is open on your Mac and that both are on the same Wi‑Fi."
        }
      }
    }
  }

  /// Retries with backoff for about two minutes, then gives up (Bonjour can still bring it back).
  private func scheduleReconnect(_ name: String) {
    reconnectTask = Task { [weak self] in
      for delay in [1.0, 2.0, 3.0, 5.0, 8.0, 13.0, 21.0, 30.0, 30.0] {
        try? await Task.sleep(for: .seconds(delay))
        guard let self, !Task.isCancelled else { return }
        guard case .reconnecting = self.phase else {
          self.reconnectTask = nil
          return
        }
        if self.connection == nil, let endpoint = self.lastEndpoint {
          self.attempt(endpoint, name: name, quietly: true)
        }
      }
      guard let self, !Task.isCancelled else { return }
      self.reconnectTask = nil
      if case .reconnecting = self.phase, self.connection == nil {
        self.phase = .searching
        self.lastError = "Lost the connection to \(name)."
      }
    }
  }

  private func stopReconnecting() {
    reconnectTask?.cancel()
    reconnectTask = nil
  }

  // MARK: - Messages from the Mac

  private func handle(_ message: ToPad, _ frame: Frame?) {
    switch message {
    case let .welcome(welcome):
      stopReconnecting()
      macName = welcome.macName
      UserDefaults.standard.set(welcome.macName, forKey: "lastMac")
      phase = .connected(welcome.macName)
      lastError = nil
      sendView()
      sendUnsentInk()
    case let .pairNeeded(needed):
      stopReconnecting()
      macName = needed.macName
      if let code = pendingCode {
        pendingCode = nil
        connection?.send(.pair(code: code))
      } else {
        phase = .pairing(needed.macName)
      }
    case let .paired(paired):
      if let name = macName { Keychain.setToken(paired.token, for: name) }
    case let .pairFailed(failed):
      pairingError = failed.reason
      phase = .pairing(macName ?? "your Mac")
    case let .notes(list):
      notes = list.notes
      macActiveNote = list.active
    case let .note(info):
      if annotating {
        pendingNote = info
        updateWaiting = true
      } else {
        note = info
      }
    case let .pdf(header):
      guard let frame, let data = try? frame.part(header.parts.data), let pdf = Self.pdfDocument(data) else { return }
      let received = NotePDF(rev: header.rev, theme: header.theme, document: pdf)
      if annotating {
        pendingPDF = received
        updateWaiting = true
      } else {
        self.pdf = received
      }
    case let .annotations(header):
      // Our newer handwriting hasn't reached the Mac yet: don't flash back to the older one.
      guard let frame, annotationOutbox.items[header.note] == nil else { return }
      let strokes = placeAnnotations(header, frame)
      if annotating {
        pendingAnnotations = strokes
      } else {
        annotationStrokes = strokes
        annotationVersion += 1
      }
    case let .sketchOpen(header):
      openSketch(header, frame)
    case let .sketchAck(ack):
      sketchRev = max(sketchRev, ack.rev)
      sketchOutbox.acknowledged(ack.id)
      outboxChanged()
    case let .annotateAck(ack):
      annotationOutbox.acknowledged(ack.note)
      outboxChanged()
    case let .toast(toast):
      show(toast.message)
    case .unknown:
      break
    }
  }

  private static func pdfDocument(_ data: Data) -> CGPDFDocument? {
    guard let provider = CGDataProvider(data: data as CFData) else { return nil }
    return CGPDFDocument(provider)
  }

  private func placeAnnotations(_ header: AnnotationsHeader, _ frame: Frame) -> [PKStroke] {
    let layout = self.layout
    var strokes: [PKStroke] = []
    for cluster in header.clusters {
      guard let data = try? frame.part(cluster.pk), let drawing = try? PKDrawing(data: data) else { continue }
      strokes += Clusterer.place(drawing, page: cluster.page, x: cluster.x, y: cluster.y, layout: layout)
    }
    return strokes
  }

  func show(_ message: String) {
    toast = message
    Task {
      try? await Task.sleep(for: .seconds(3.5))
      if toast == message { toast = nil }
    }
  }

  // MARK: - Viewing

  func follow() {
    following = true
    sendView()
  }

  func view(note path: String) {
    following = false
    sendView(path)
  }

  func setPaperTheme(_ theme: PaperTheme) {
    guard theme != paperTheme else { return }
    paperTheme = theme
    sendView(following ? nil : note?.note)
  }

  private func sendView(_ path: String? = nil) {
    connection?.send(.view(note: following ? nil : (path ?? note?.note), theme: paperTheme))
  }

  /// A tap on the page in view mode: open the sketch under it.
  func tapped(at point: CGPoint) {
    guard let note, let hit = layout.pagePoint(point) else { return }
    if let sketch = note.sketches.first(where: {
      $0.page == hit.page && CGRect(x: $0.x, y: $0.y, width: $0.w, height: $0.h).contains(hit.point)
    }) {
      connection?.send(.sketchRequest(id: sketch.id))
    }
  }

  // MARK: - Annotations

  func beginAnnotating() {
    annotating = true
  }

  /// Sends all handwriting on the page(s) and applies anything the Mac changed meanwhile.
  func finishAnnotating(_ drawing: PKDrawing) {
    guard let note else {
      annotating = false
      return
    }
    let layout = self.layout
    let clusters = Clusterer.clusters(of: drawing.strokes, layout: layout)
    var payload = PayloadBuilder()
    var outgoing: [FromPad.OutgoingCluster] = []
    for (i, cluster) in clusters.enumerated() {
      let clusterDrawing = PKDrawing(strokes: cluster.strokes)
      let pk = payload.append(clusterDrawing.dataRepresentation())
      outgoing.append(
        FromPad.OutgoingCluster(
          id: "c\(i + 1)",
          page: cluster.page,
          bbox: [cluster.bbox.minX, cluster.bbox.minY, cluster.bbox.width, cluster.bbox.height].map { Double($0) },
          render: StrokeRender.render(clusterDrawing, darkColor: Self.darkColor),
          pk: pk
        ))
    }
    let pages = Array(1...max(1, note.pages.count))
    let upload = AnnotationUpload(
      mac: macName ?? "",
      message: .annotatePut(note: note.note, viewedRev: note.rev, pages: pages, clusters: outgoing),
      payload: payload.payload
    )
    annotationOutbox.put(note.note, upload)
    outboxChanged()
    send(upload, note: note.note)
    annotationStrokes = drawing.strokes
    annotating = false
    applyPendingUpdate()
  }

  func applyPendingUpdate() {
    if let pendingNote { note = pendingNote }
    if let pendingPDF { pdf = pendingPDF }
    if let pendingAnnotations {
      annotationStrokes = pendingAnnotations
      annotationVersion += 1
    }
    pendingNote = nil
    pendingPDF = nil
    pendingAnnotations = nil
    updateWaiting = false
  }

  // MARK: - Sketches

  func newSketch() {
    guard connectedMac != nil else { return show("Connect to your Mac first.") }
    connection?.send(.sketchNew)
  }

  private func openSketch(_ header: SketchOpenHeader, _ frame: Frame?) {
    var drawing = PKDrawing()
    if let data = try? frame?.part(header.parts.pk), let existing = try? PKDrawing(data: data) {
      drawing = existing
    }
    var background: SketchBackground?
    if let bytes = try? frame?.part(header.parts.background), let info = header.background {
      if info.mime == "application/pdf", let doc = Self.pdfDocument(bytes), let page = doc.page(at: info.page ?? 1) {
        background = .pdf(page)
      } else if let image = UIImage(data: bytes) {
        background = .image(image)
      }
    }
    sketchRev = header.rev
    sketch = SketchSession(
      id: header.id,
      note: header.note,
      size: CGSize(width: header.size.w, height: header.size.h),
      ruling: header.ruling,
      background: background,
      drawing: drawing
    )
  }

  /// Sends the whole sketch (the Mac keeps the latest one).
  func saveSketch(_ drawing: PKDrawing, size: CGSize) {
    guard var session = sketch else { return }
    session.drawing = drawing
    session.size = size
    sketch = session
    let upload = SketchUpload(mac: macName ?? "", size: size, drawing: drawing)
    sketchOutbox.put(session.id, upload)
    outboxChanged()
    send(upload, sketch: session.id)
  }

  private func send(_ upload: SketchUpload, sketch id: String) {
    guard let connection, connectedMac == upload.mac else { return }
    sketchRev += 1
    var payload = PayloadBuilder()
    let pk = payload.append(upload.drawing.dataRepresentation())
    connection.send(
      .sketchPut(
        id: id,
        rev: sketchRev,
        size: Size(w: upload.size.width, h: upload.size.height),
        render: StrokeRender.render(upload.drawing, darkColor: Self.darkColor),
        pk: pk
      ),
      payload: payload.payload
    )
    sketchOutbox.sent(id)
  }

  // MARK: - Unconfirmed ink

  private func send(_ upload: AnnotationUpload, note: String) {
    guard let connection, connectedMac == upload.mac else { return }
    connection.send(upload.message, payload: upload.payload)
    annotationOutbox.sent(note)
  }

  /// Sends what the Mac never confirmed: it restarted, slept or dropped off the Wi-Fi meanwhile.
  private func sendUnsentInk() {
    for (id, upload) in sketchOutbox.items { send(upload, sketch: id) }
    for (note, upload) in annotationOutbox.items { send(upload, note: note) }
  }

  private func outboxChanged() {
    hasUnsentInk = !sketchOutbox.isEmpty || !annotationOutbox.isEmpty
  }

  func closeSketch() {
    if let id = sketch?.id { connection?.send(.sketchClose(id: id)) }
    sketch = nil
  }

  // MARK: - Photos

  func sendPhoto(_ image: UIImage, drawOn: Bool) {
    guard connectedMac != nil else { return show("Not connected to your Mac. Try again once it's back.") }
    guard let data = PhotoPrep.jpeg(image) else { return show("That photo couldn't be read.") }
    var payload = PayloadBuilder()
    let range = payload.append(data)
    connection?.send(.image(name: "photo.jpg", mime: "image/jpeg", mode: drawOn ? "drawOn" : "insert", data: range), payload: payload.payload)
  }

  // MARK: - Helpers

  /// PencilKit's own light → dark ink colour mapping.
  nonisolated static func darkColor(_ color: CGColor) -> CGColor {
    PKInkingTool.convertColor(UIColor(cgColor: color), from: .light, to: .dark).cgColor
  }
}
