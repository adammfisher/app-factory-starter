import ExpoModulesCore
import UIKit

// The phone's share sheet, print dialog and save dialog. Each call resolves true when the person
// went through with it and false when they dismissed it.
public class FileExchangeModule: Module {
  // Each open save dialog's delegate, kept alive until that dialog closes.
  private var saving: [ObjectIdentifier: SaveDelegate] = [:]

  public func definition() -> ModuleDefinition {
    Name("FileExchange")

    AsyncFunction("shareAsync") { (uri: String, promise: Promise) in
      guard let url = Self.fileURL(uri) else { return promise.reject("ERR_FILE", "No file at \(uri)") }
      guard let presenter = self.presenter() else { return promise.reject("ERR_NO_VIEW", "Nothing to present from") }
      let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
      let once = Once(promise)
      sheet.completionWithItemsHandler = { _, completed, _, error in
        if let error { once.reject("ERR_SHARE", error.localizedDescription) } else { once.resolve(completed) }
      }
      Self.anchor(sheet, in: presenter)
      presenter.present(sheet, animated: true)
    }.runOnQueue(.main)

    AsyncFunction("printAsync") { (uri: String, promise: Promise) in
      guard let url = Self.fileURL(uri) else { return promise.reject("ERR_FILE", "No file at \(uri)") }
      guard UIPrintInteractionController.canPrint(url) else { return promise.reject("ERR_PRINT", "This file cannot be printed") }
      let controller = UIPrintInteractionController.shared
      let info = UIPrintInfo(dictionary: nil)
      info.jobName = url.lastPathComponent
      info.outputType = .general
      controller.printInfo = info
      controller.printingItem = url
      let once = Once(promise)
      let done: UIPrintInteractionController.CompletionHandler = { _, completed, error in
        if let error { once.reject("ERR_PRINT", error.localizedDescription) } else { once.resolve(completed) }
      }
      if UIDevice.current.userInterfaceIdiom == .pad, let view = self.presenter()?.view {
        controller.present(from: CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1), in: view, animated: true, completionHandler: done)
      } else {
        controller.present(animated: true, completionHandler: done)
      }
    }.runOnQueue(.main)

    AsyncFunction("saveAsAsync") { (uri: String, name: String, promise: Promise) in
      guard let url = Self.fileURL(uri) else { return promise.reject("ERR_FILE", "No file at \(uri)") }
      guard let presenter = self.presenter() else { return promise.reject("ERR_NO_VIEW", "Nothing to present from") }
      // The dialog offers the file under the name the app chose, so it is copied to that name first.
      let copy: URL
      do {
        copy = try Self.copy(url, as: name)
      } catch {
        return promise.reject("ERR_FILE", error.localizedDescription)
      }
      let picker = UIDocumentPickerViewController(forExporting: [copy], asCopy: true)
      let key = ObjectIdentifier(picker)
      let delegate = SaveDelegate(Once(promise)) { [weak self] in
        try? FileManager.default.removeItem(at: copy.deletingLastPathComponent())
        self?.saving[key] = nil
      }
      self.saving[key] = delegate
      picker.delegate = delegate
      presenter.present(picker, animated: true) {
        // Swiping the dialog away counts as cancelling it.
        picker.presentationController?.delegate = delegate
      }
    }.runOnQueue(.main)
  }

  private func presenter() -> UIViewController? {
    var top = appContext?.utilities?.currentViewController()
    while let presented = top?.presentedViewController, !presented.isBeingDismissed { top = presented }
    return top
  }

  static func fileURL(_ uri: String) -> URL? {
    let url = uri.hasPrefix("file://") ? URL(string: uri) : URL(fileURLWithPath: uri)
    guard let url, FileManager.default.fileExists(atPath: url.path) else { return nil }
    return url
  }

  static func copy(_ url: URL, as name: String) throws -> URL {
    let safe = name.replacingOccurrences(of: "/", with: "-").trimmingCharacters(in: .whitespaces)
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let target = folder.appendingPathComponent(safe.isEmpty ? url.lastPathComponent : safe)
    try FileManager.default.copyItem(at: url, to: target)
    return target
  }

  // On iPad a sheet must point at something; the middle of the screen will do.
  static func anchor(_ sheet: UIViewController, in presenter: UIViewController) {
    guard let popover = sheet.popoverPresentationController, let view = presenter.view else { return }
    popover.sourceView = view
    popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
    popover.permittedArrowDirections = []
  }
}

// Settles a promise once, whatever the system calls back afterwards.
final class Once {
  private var promise: Promise?
  init(_ promise: Promise) { self.promise = promise }
  func resolve(_ value: Bool) { promise?.resolve(value); promise = nil }
  func reject(_ code: String, _ message: String) { promise?.reject(code, message); promise = nil }
}

final class SaveDelegate: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
  private let once: Once
  private let finished: () -> Void
  init(_ once: Once, finished: @escaping () -> Void) {
    self.once = once
    self.finished = finished
  }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    once.resolve(!urls.isEmpty)
    finished()
  }
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    once.resolve(false)
    finished()
  }
  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    once.resolve(false)
    finished()
  }
}
