// Photos: downscaling for sending, the camera, and the pairing QR scanner.

import SwiftUI
import TypinkPadCore
import UIKit
import VisionKit

enum PhotoPrep {
  /// JPEG no larger than 2400 px on the long side.
  static func jpeg(_ image: UIImage, maxDimension: CGFloat = 2400, quality: CGFloat = 0.85) -> Data? {
    let longest = max(image.size.width, image.size.height) * image.scale
    guard longest > maxDimension else { return image.jpegData(compressionQuality: quality) }
    let factor = maxDimension / longest
    let target = CGSize(width: image.size.width * image.scale * factor, height: image.size.height * image.scale * factor)
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: target))
    }
    return resized.jpegData(compressionQuality: quality)
  }
}

struct CameraPicker: UIViewControllerRepresentable {
  let onFinish: (UIImage?) -> Void

  func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

  func makeUIViewController(context: Context) -> UIImagePickerController {
    let picker = UIImagePickerController()
    picker.sourceType = .camera
    picker.delegate = context.coordinator
    return picker
  }

  func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

  final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    let onFinish: (UIImage?) -> Void

    init(onFinish: @escaping (UIImage?) -> Void) {
      self.onFinish = onFinish
    }

    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
      onFinish(info[.originalImage] as? UIImage)
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
      onFinish(nil)
    }
  }
}

/// Scans the QR code in the Mac's iPad panel.
struct QRScannerSheet: View {
  let onLink: (PairingLink) -> Void
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      Group {
        if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
          QRScanner(onLink: onLink).ignoresSafeArea()
        } else {
          ContentUnavailableView(
            "Camera unavailable",
            systemImage: "camera.fill",
            description: Text("Allow camera access for Typink in Settings, or pick your Mac from the list.")
          )
        }
      }
      .navigationTitle("Scan the code on your Mac")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
      }
    }
  }
}

private struct QRScanner: UIViewControllerRepresentable {
  let onLink: (PairingLink) -> Void

  func makeCoordinator() -> Coordinator { Coordinator(onLink: onLink) }

  func makeUIViewController(context: Context) -> DataScannerViewController {
    let scanner = DataScannerViewController(
      recognizedDataTypes: [.barcode(symbologies: [.qr])],
      qualityLevel: .balanced,
      isHighlightingEnabled: true
    )
    scanner.delegate = context.coordinator
    try? scanner.startScanning()
    return scanner
  }

  func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {}

  @MainActor
  final class Coordinator: NSObject, DataScannerViewControllerDelegate {
    let onLink: (PairingLink) -> Void
    private var done = false

    init(onLink: @escaping (PairingLink) -> Void) {
      self.onLink = onLink
    }

    func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
      for item in addedItems {
        guard !done, case let .barcode(code) = item, let text = code.payloadStringValue, let link = PairingLink(text) else { continue }
        done = true
        dataScanner.stopScanning()
        onLink(link)
      }
    }
  }
}
