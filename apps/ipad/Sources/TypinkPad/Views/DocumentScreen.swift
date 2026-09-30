// The note from the Mac, live, with sketches to tap and handwriting on top.

import PencilKit
import PhotosUI
import SwiftUI
import TypinkPadCore

/// Lets SwiftUI buttons reach the UIKit canvas.
@MainActor
final class CanvasRef {
  weak var controller: CanvasController?
}

struct DocumentScreen: View {
  @Environment(PadModel.self) private var model
  @State private var canvas = CanvasRef()
  @State private var photoItem: PhotosPickerItem?
  @State private var pickingPhoto = false
  @State private var drawOnPhoto = false
  @State private var takingPhoto = false

  var body: some View {
    NavigationStack {
      ZStack(alignment: .top) {
        if model.pdf == nil {
          ContentUnavailableView {
            Label(model.macActiveNote == nil ? "No note open" : "Loading…", systemImage: "doc.text")
          } description: {
            Text(model.macActiveNote == nil ? "Open a note on your Mac, or pick one from the title menu." : "")
          }
        } else {
          DocumentCanvas(model: model, ref: canvas)
            .ignoresSafeArea(edges: .bottom)
        }
        if model.reconnecting {
          OfflineBanner()
        } else if model.updateWaiting {
          Button {
            model.finishAnnotating(canvas.controller?.canvas.drawing ?? PKDrawing())
          } label: {
            Label("Changed on your Mac — save handwriting and refresh", systemImage: "arrow.clockwise")
              .font(.callout)
          }
          .buttonStyle(.borderedProminent)
          .padding(.top, 8)
        }
      }
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { toolbar }
      .photosPicker(isPresented: $pickingPhoto, selection: $photoItem, matching: .images)
      .onChange(of: photoItem) { _, item in
        guard let item else { return }
        photoItem = nil
        Task {
          if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
            model.sendPhoto(image, drawOn: drawOnPhoto)
          }
        }
      }
      .fullScreenCover(isPresented: $takingPhoto) {
        CameraPicker { image in
          takingPhoto = false
          if let image { model.sendPhoto(image, drawOn: drawOnPhoto) }
        }
        .ignoresSafeArea()
      }
    }
  }

  @ToolbarContentBuilder
  private var toolbar: some ToolbarContent {
    ToolbarItem(placement: .topBarLeading) {
      Menu {
        Section(model.macDisplayName ?? "") {
          Picker("Paper", selection: Binding(get: { model.paperTheme }, set: { model.setPaperTheme($0) })) {
            Text("Light paper").tag(PaperTheme.light)
            Text("Dark paper").tag(PaperTheme.dark)
          }
          Button("Disconnect", systemImage: "wifi.slash") { model.disconnect() }
          Button("Forget this Mac", systemImage: "trash", role: .destructive) { model.disconnect(forget: true) }
        }
      } label: {
        Label(model.macDisplayName ?? "Mac", systemImage: model.reconnecting ? "laptopcomputer.slash" : "laptopcomputer")
          .labelStyle(.titleAndIcon)
      }
    }
    ToolbarItem(placement: .principal) {
      Menu {
        Button {
          model.follow()
        } label: {
          Label("Follow the note open on the Mac", systemImage: model.following ? "checkmark" : "arrow.triangle.2.circlepath")
        }
        Divider()
        ForEach(model.notes) { note in
          Button(note.folder.isEmpty ? note.name : "\(note.folder) / \(note.name)") { model.view(note: note.path) }
        }
      } label: {
        HStack(spacing: 4) {
          Text(model.note?.title ?? "Typink").font(.headline)
          Image(systemName: "chevron.down").font(.caption.bold()).foregroundStyle(.secondary)
        }
      }
    }
    ToolbarItemGroup(placement: .topBarTrailing) {
      if model.annotating {
        // Also while reconnecting: the handwriting is kept until the Mac confirms it.
        Button("Done") {
          model.finishAnnotating(canvas.controller?.canvas.drawing ?? PKDrawing())
        }
        .bold()
      } else if model.reconnecting {
        EmptyView()
      } else {
        Button {
          model.newSketch()
        } label: {
          Label("New sketch at cursor", systemImage: "scribble.variable")
        }
        Menu {
          Button("Insert a photo", systemImage: "photo") {
            drawOnPhoto = false
            pickingPhoto = true
          }
          Button("Draw on a photo", systemImage: "photo.badge.plus") {
            drawOnPhoto = true
            pickingPhoto = true
          }
          if UIImagePickerController.isSourceTypeAvailable(.camera) {
            Button("Take a photo to insert", systemImage: "camera") {
              drawOnPhoto = false
              takingPhoto = true
            }
            Button("Take a photo to draw on", systemImage: "camera.badge.ellipsis") {
              drawOnPhoto = true
              takingPhoto = true
            }
          }
        } label: {
          Label("Photo", systemImage: "photo.on.rectangle")
        }
        Button {
          model.beginAnnotating()
        } label: {
          Label("Write on the page", systemImage: "pencil.tip.crop.circle")
        }
        .disabled(model.pdf == nil)
      }
    }
  }
}

/// Shown while the Mac is out of reach. Handwriting is kept and sent once it's back.
struct OfflineBanner: View {
  @Environment(PadModel.self) private var model

  var body: some View {
    VStack(spacing: 2) {
      if model.reconnecting {
        Label {
          Text("Reconnecting to \(model.macDisplayName ?? "your Mac")…")
        } icon: {
          ProgressView().controlSize(.small)
        }
      } else {
        Label("Not connected to your Mac", systemImage: "wifi.slash")
      }
      if model.hasUnsentInk {
        Text("Your handwriting is kept and sent once it's back.")
          .foregroundStyle(.secondary)
      }
    }
    .font(.callout)
    .padding(.horizontal, 16)
    .padding(.vertical, 8)
    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    .padding(.top, 8)
  }
}

/// The note's pages under a PencilKit canvas holding the handwriting.
struct DocumentCanvas: UIViewControllerRepresentable {
  let model: PadModel
  let ref: CanvasRef

  final class Coordinator {
    var document: CGPDFDocument?
    var annotationVersion = -1
  }

  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeUIViewController(context: Context) -> CanvasController {
    let controller = CanvasController()
    ref.controller = controller
    controller.onTap = { [weak model] point in model?.tapped(at: point) }
    return controller
  }

  func updateUIViewController(_ controller: CanvasController, context: Context) {
    let coordinator = context.coordinator
    if let pdf = model.pdf, pdf.document !== coordinator.document {
      coordinator.document = pdf.document
      let layout = pageLayout(pdf)
      let paper: UIColor = pdf.theme == .dark ? UIColor(red: 0.11, green: 0.11, blue: 0.118, alpha: 1) : .white
      var views: [UIView] = []
      for (i, frame) in layout.pageFrames.enumerated() {
        if let page = pdf.document.page(at: i + 1) {
          views.append(TiledPDFPageView(page: page, frame: frame, paper: paper))
        }
      }
      controller.paper = pdf.theme
      controller.setUnderlay(views, size: layout.size)
    }
    if !model.annotating, coordinator.annotationVersion != model.annotationVersion {
      coordinator.annotationVersion = model.annotationVersion
      controller.setDrawing(PKDrawing(strokes: model.annotationStrokes))
    }
    if controller.drawingEnabled != model.annotating { controller.drawingEnabled = model.annotating }
  }

  /// Page frames from the PDF's own (exact) page boxes.
  private func pageLayout(_ pdf: NotePDF) -> DocumentLayout {
    let sizes = (0..<pdf.document.numberOfPages).compactMap { i -> CGSize? in
      pdf.document.page(at: i + 1).map { $0.getBoxRect(.mediaBox).size }
    }
    return DocumentLayout(pages: sizes)
  }
}
