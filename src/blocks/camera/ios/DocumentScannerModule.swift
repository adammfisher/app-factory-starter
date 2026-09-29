import AVFoundation
import ExpoModulesCore
import UIKit
import VisionKit

// Apple's document camera (VisionKit). Each scanned page is saved as a JPEG in the app's caches
// and comes back as { uri, width, height }. Cancelling rejects with ERR_CANCELLED. The Simulator
// has no document camera, so there it rejects with ERR_NOT_SUPPORTED.
public class DocumentScannerModule: Module {
  private var scanning: ScanDelegate?

  public func definition() -> ModuleDefinition {
    Name("DocumentScanner")

    AsyncFunction("requestPermissionAsync") { (promise: Promise) in
      guard VNDocumentCameraViewController.isSupported else {
        return promise.reject("ERR_NOT_SUPPORTED", "This device has no document camera")
      }
      switch AVCaptureDevice.authorizationStatus(for: .video) {
      case .authorized: promise.resolve(true)
      case .notDetermined: AVCaptureDevice.requestAccess(for: .video) { promise.resolve($0) }
      default: promise.resolve(false)
      }
    }

    AsyncFunction("scanAsync") { (promise: Promise) in
      guard VNDocumentCameraViewController.isSupported else {
        return promise.reject("ERR_NOT_SUPPORTED", "This device has no document camera")
      }
      guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
        return promise.reject("ERR_CAMERA_DENIED", "Camera access is off")
      }
      guard self.scanning == nil else { return promise.reject("ERR_BUSY", "A scan is already open") }
      guard let presenter = self.presenter() else { return promise.reject("ERR_NO_VIEW", "Nothing to present from") }
      let camera = VNDocumentCameraViewController()
      let delegate = ScanDelegate(promise) { [weak self] in self?.scanning = nil }
      self.scanning = delegate
      camera.delegate = delegate
      presenter.present(camera, animated: true)
    }.runOnQueue(.main)
  }

  private func presenter() -> UIViewController? {
    var top = appContext?.utilities?.currentViewController()
    while let presented = top?.presentedViewController, !presented.isBeingDismissed { top = presented }
    return top
  }
}

final class ScanDelegate: NSObject, VNDocumentCameraViewControllerDelegate {
  private var promise: Promise?
  private let finished: () -> Void

  init(_ promise: Promise, finished: @escaping () -> Void) {
    self.promise = promise
    self.finished = finished
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
    let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("scans", isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      var pages: [[String: Any]] = []
      for index in 0..<scan.pageCount {
        let image = scan.imageOfPage(at: index)
        guard let data = image.jpegData(compressionQuality: 0.9) else { continue }
        let file = folder.appendingPathComponent("\(UUID().uuidString).jpg")
        try data.write(to: file)
        pages.append(["uri": file.absoluteString, "width": image.size.width * image.scale, "height": image.size.height * image.scale])
      }
      settle { $0.resolve(pages) }
    } catch {
      settle { $0.reject("ERR_SCAN", error.localizedDescription) }
    }
    controller.dismiss(animated: true)
  }

  func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
    settle { $0.reject("ERR_CANCELLED", "The scan was cancelled") }
    controller.dismiss(animated: true)
  }

  func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
    let denied = AVCaptureDevice.authorizationStatus(for: .video) != .authorized
    settle { $0.reject(denied ? "ERR_CAMERA_DENIED" : "ERR_SCAN", error.localizedDescription) }
    controller.dismiss(animated: true)
  }

  private func settle(_ body: (Promise) -> Void) {
    guard let promise else { return }
    self.promise = nil
    body(promise)
    finished()
  }
}
