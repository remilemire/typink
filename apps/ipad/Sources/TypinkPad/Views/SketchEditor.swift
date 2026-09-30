// Full-screen sketch editing. Every pause sends the whole sketch to the Mac,
// which renders it into the note within a moment.

import PencilKit
import SwiftUI
import TypinkPadCore

struct SketchEditor: View {
  @Environment(PadModel.self) private var model
  let session: SketchSession
  @State private var canvas = CanvasRef()
  @State private var size: CGSize
  @State private var saveTask: Task<Void, Never>?
  @State private var dirty = false

  init(session: SketchSession) {
    self.session = session
    _size = State(initialValue: session.size)
  }

  /// Rule pitch in canvas units (used for growing the canvas).
  private var step: CGFloat {
    CGFloat(session.ruling?.pitch ?? 24)
  }

  private var canGrow: Bool { session.background == nil }

  var body: some View {
    NavigationStack {
      SketchCanvas(session: session, size: size, paper: model.paperTheme, ref: canvas) { drawing in
        changed(drawing)
      }
      .ignoresSafeArea(edges: .bottom)
      .overlay(alignment: .top) {
        if model.connectedMac == nil { OfflineBanner() }
      }
      .navigationTitle("Sketch")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button("Done") { finish() }.bold()
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
          Button {
            canvas.controller?.canvas.undoManager?.undo()
          } label: {
            Label("Undo", systemImage: "arrow.uturn.backward")
          }
          Button {
            canvas.controller?.canvas.undoManager?.redo()
          } label: {
            Label("Redo", systemImage: "arrow.uturn.forward")
          }
          if canGrow {
            Button {
              grow(by: 4)
            } label: {
              Label("More room", systemImage: "arrow.down.to.line.compact")
            }
          }
        }
      }
    }
  }

  private func changed(_ drawing: PKDrawing) {
    dirty = true
    // Grow the canvas as you write near the bottom, like a notebook.
    if canGrow, !drawing.strokes.isEmpty, drawing.bounds.maxY > size.height - step * 1.5 {
      grow(by: 4)
    }
    saveTask?.cancel()
    let size = self.size
    saveTask = Task {
      try? await Task.sleep(for: .milliseconds(250))
      guard !Task.isCancelled else { return }
      model.saveSketch(drawing, size: size)
      dirty = false
    }
  }

  private func grow(by lines: CGFloat) {
    size.height += step * lines
    dirty = true
  }

  private func finish() {
    saveTask?.cancel()
    if dirty, let drawing = canvas.controller?.canvas.drawing {
      model.saveSketch(drawing, size: size)
    }
    model.closeSketch()
  }
}

/// The sketch canvas: ruled paper (or a photo/PDF page) under PencilKit.
struct SketchCanvas: UIViewControllerRepresentable {
  let session: SketchSession
  let size: CGSize
  let paper: PaperTheme
  let ref: CanvasRef
  let onChange: (PKDrawing) -> Void

  final class Coordinator {
    var size: CGSize = .zero
  }

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeUIViewController(context: Context) -> CanvasController {
    let controller = CanvasController()
    ref.controller = controller
    controller.loadViewIfNeeded()
    // Photos and slides are light; ruled paper follows the iPad's appearance.
    controller.paper = session.background == nil ? paper : .light
    controller.setDrawing(session.drawing)
    controller.onDrawingChanged = onChange
    controller.drawingEnabled = true
    return controller
  }

  func updateUIViewController(_ controller: CanvasController, context: Context) {
    controller.onDrawingChanged = onChange
    guard context.coordinator.size != size else { return }
    context.coordinator.size = size
    let underlay: UIView
    switch session.background {
    case let .image(image):
      let view = UIImageView(image: image)
      view.frame = CGRect(origin: .zero, size: size)
      view.contentMode = .scaleToFill
      underlay = view
    case let .pdf(page):
      underlay = PDFBackgroundView(page: page, size: size)
    case nil:
      underlay = RulingView(size: size, ruling: session.ruling, dark: paper == .dark)
    }
    controller.setUnderlay([underlay], size: size)
  }
}
