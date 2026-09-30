// One PKCanvasView that scrolls and zooms, with content (PDF pages, or a
// sketch's ruling/background) drawn underneath. Canvas units are points, so
// drawing coordinates map 1:1 to the page.

import PencilKit
import TypinkPadCore
import UIKit

@MainActor
final class CanvasController: UIViewController, PKCanvasViewDelegate {
  let canvas = PKCanvasView()
  private let underlay = UIView()
  private(set) var contentSize = CGSize(width: 595, height: 842)
  private var fitted = false
  private var suppressChanges = false

  /// Called (debounced by the owner) whenever the user changes the drawing.
  var onDrawingChanged: ((PKDrawing) -> Void)?
  /// A single tap in view mode, in canvas coordinates.
  var onTap: ((CGPoint) -> Void)?

  let toolPicker = PKToolPicker(toolItems: [
    PKToolPickerInkingItem(type: .pen),
    PKToolPickerInkingItem(type: .monoline),
    PKToolPickerInkingItem(type: .fountainPen),
    PKToolPickerInkingItem(type: .marker),
    PKToolPickerEraserItem(type: .bitmap),
    PKToolPickerLassoItem(),
    PKToolPickerRulerItem(),
  ])

  var drawingEnabled = false {
    didSet { applyDrawingEnabled() }
  }

  var paper: PaperTheme = .light {
    didSet {
      let style: UIUserInterfaceStyle = paper == .dark ? .dark : .light
      canvas.overrideUserInterfaceStyle = style
      toolPicker.colorUserInterfaceStyle = style
    }
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .secondarySystemBackground
    canvas.delegate = self
    canvas.backgroundColor = .clear
    canvas.isOpaque = false
    canvas.contentInsetAdjustmentBehavior = .never
    canvas.alwaysBounceVertical = true
    canvas.minimumZoomScale = 0.25
    canvas.maximumZoomScale = 8
    #if targetEnvironment(simulator)
      canvas.drawingPolicy = .anyInput
    #else
      // Follows Settings › Apple Pencil › Only Draw with Apple Pencil: with a Pencil, fingers
      // scroll and zoom (palm rejection); without one, a finger can draw.
      canvas.drawingPolicy = .default
    #endif
    canvas.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(canvas)
    NSLayoutConstraint.activate([
      canvas.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      canvas.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      canvas.topAnchor.constraint(equalTo: view.topAnchor),
      canvas.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    canvas.insertSubview(underlay, at: 0)
    underlay.isUserInteractionEnabled = false

    let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
    tap.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue), NSNumber(value: UITouch.TouchType.pencil.rawValue)]
    canvas.addGestureRecognizer(tap)
    applyDrawingEnabled()
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    // Becoming first responder (for the tool picker) only works once we're on screen.
    applyDrawingEnabled()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    if !fitted, view.bounds.width > 0 {
      fitted = true
      fitWidth()
    }
    layoutContent()
  }

  // MARK: - Content

  /// Replaces what's drawn under the ink. `size` is in canvas units (pt).
  func setUnderlay(_ views: [UIView], size: CGSize) {
    underlay.subviews.forEach { $0.removeFromSuperview() }
    views.forEach { underlay.addSubview($0) }
    let changedWidth = abs(size.width - contentSize.width) > 0.5
    contentSize = size
    underlay.bounds = CGRect(origin: .zero, size: size)
    if changedWidth { fitted = false }
    view.setNeedsLayout()
    layoutContent()
  }

  /// Sets the drawing without reporting it back as a user change.
  func setDrawing(_ drawing: PKDrawing) {
    suppressChanges = true
    canvas.drawing = drawing
    suppressChanges = false
  }

  func fitWidth() {
    guard contentSize.width > 0, view.bounds.width > 0 else { return }
    let fit = (view.bounds.width - 32) / contentSize.width
    canvas.minimumZoomScale = fit * 0.5
    canvas.maximumZoomScale = fit * 6
    canvas.zoomScale = fit
    canvas.contentOffset = CGPoint(x: -canvas.contentInset.left, y: -canvas.contentInset.top)
  }

  private func layoutContent() {
    let z = canvas.zoomScale
    let scaled = CGSize(width: contentSize.width * z, height: contentSize.height * z)
    canvas.contentSize = scaled
    underlay.transform = CGAffineTransform(scaleX: z, y: z)
    underlay.center = CGPoint(x: scaled.width / 2, y: scaled.height / 2)
    // Center content narrower than the screen.
    let side = max(16, (view.bounds.width - scaled.width) / 2)
    canvas.contentInset = UIEdgeInsets(top: 16, left: side, bottom: 120, right: side)
  }

  private func applyDrawingEnabled() {
    guard isViewLoaded else { return }
    canvas.drawingGestureRecognizer.isEnabled = drawingEnabled
    toolPicker.setVisible(drawingEnabled, forFirstResponder: canvas)
    if drawingEnabled {
      toolPicker.addObserver(canvas)
      canvas.becomeFirstResponder()
    } else {
      toolPicker.removeObserver(canvas)
      canvas.resignFirstResponder()
    }
  }

  @objc private func tapped(_ gesture: UITapGestureRecognizer) {
    guard !drawingEnabled else { return }
    let p = gesture.location(in: canvas)
    let z = canvas.zoomScale
    onTap?(CGPoint(x: p.x / z, y: p.y / z))
  }

  // MARK: - PKCanvasViewDelegate / UIScrollViewDelegate

  func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
    guard !suppressChanges else { return }
    onDrawingChanged?(canvasView.drawing)
  }

  func scrollViewDidZoom(_ scrollView: UIScrollView) {
    layoutContent()
  }
}
