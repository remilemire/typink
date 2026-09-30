import SwiftUI
import TypinkPadCore

@main
struct TypinkPadApp: App {
  @State private var model = PadModel()

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
    }
  }
}

struct RootView: View {
  @Environment(PadModel.self) private var model
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    Group {
      if model.showsDocument {
        DocumentScreen()
      } else {
        ConnectView()
      }
    }
    .overlay(alignment: .bottom) {
      if let toast = model.toast {
        Text(toast)
          .font(.callout)
          .padding(.horizontal, 16)
          .padding(.vertical, 10)
          .background(.thinMaterial, in: Capsule())
          .padding(.bottom, 28)
          .transition(.move(edge: .bottom).combined(with: .opacity))
      }
    }
    .animation(.snappy, value: model.toast)
    .fullScreenCover(
      item: Binding(
        get: { model.sketch },
        set: { if $0 == nil { model.closeSketch() } }
      )
    ) { session in
      SketchEditor(session: session)
        .environment(model)
    }
    .onOpenURL { url in
      // The pairing QR code on the Mac, scanned with the Camera app.
      if let link = PairingLink(url.absoluteString) { model.connect(link: link) }
    }
    .onAppear { model.setPaperTheme(colorScheme == .dark ? .dark : .light) }
    .onChange(of: colorScheme) { _, scheme in model.setPaperTheme(scheme == .dark ? .dark : .light) }
  }
}
