import ExpoModulesCore
import System
import UIKit
#if canImport(BackgroundAssets)
import BackgroundAssets
#endif

// The model as an Apple-hosted asset pack (BackgroundAssets, iOS 26). The pack's ID is the
// Info.plist value AIModelPackID ("ai-model" when unset). The pack holds the .gguf files and a
// manifest.json listing them ({ "files": ["model.gguf"] }); without a manifest, model.gguf is taken.
// Asset packs are served by the App Store, so this works in TestFlight and store builds only.
public class AiModelPackModule: Module {
  private var fetching: Task<Void, Error>?

  private var packID: String {
    (Bundle.main.object(forInfoDictionaryKey: "AIModelPackID") as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "ai-model"
  }

  public func definition() -> ModuleDefinition {
    Name("AiModelPack")
    Events("onProgress")

    AsyncFunction("getSizeAsync") { () async throws -> Int in
      #if canImport(BackgroundAssets)
      if #available(iOS 26.0, *) {
        return try await AssetPackManager.shared.assetPack(withID: self.packID).downloadSize
      }
      #endif
      throw Self.notSupported()
    }

    AsyncFunction("fetchAsync") { (directoryUri: String) async throws in
      #if canImport(BackgroundAssets)
      if #available(iOS 26.0, *) {
        guard let directory = URL(string: directoryUri), directory.isFileURL else {
          throw Exception(name: "BadDirectory", description: "Not a file directory: \(directoryUri)", code: "ERR_DIRECTORY")
        }
        let task = Task { try await self.fetch(into: directory) }
        self.fetching = task
        defer { self.fetching = nil }
        try await task.value
        return
      }
      #endif
      throw Self.notSupported()
    }

    AsyncFunction("cancelAsync") {
      self.fetching?.cancel()
    }

    AsyncFunction("showCellularDataConfirmationAsync") { (promise: Promise) in
      guard let presenter = self.presenter() else { return promise.resolve(false) }
      let alert = UIAlertController(
        title: "Download over mobile data?",
        message: "The model is a large download. You can wait for Wi-Fi instead.",
        preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "Wait for Wi-Fi", style: .cancel) { _ in promise.resolve(false) })
      alert.addAction(UIAlertAction(title: "Download", style: .default) { _ in promise.resolve(true) })
      presenter.present(alert, animated: true)
    }.runOnQueue(.main)
  }

  #if canImport(BackgroundAssets)
  @available(iOS 26.0, *)
  private func fetch(into directory: URL) async throws {
    let manager = AssetPackManager.shared
    let pack = try await manager.assetPack(withID: packID)
    let progress = Task {
      for await update in manager.statusUpdates(forAssetPackWithID: packID) {
        if case .downloading(_, let p) = update {
          self.sendEvent("onProgress", ["bytesWritten": p.completedUnitCount, "totalBytes": p.totalUnitCount])
        }
      }
    }
    defer { progress.cancel() }
    try await manager.ensureLocalAvailability(of: pack)
    try Task.checkCancellation()

    var files = ["model.gguf"]
    if let data = try? manager.contents(at: "manifest.json", searchingInAssetPackWithID: packID),
       let manifest = try? JSONDecoder().decode(Manifest.self, from: data), !manifest.files.isEmpty {
      files = manifest.files
    }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    for name in files {
      try Task.checkCancellation()
      let source = try manager.url(for: .init(name))
      let target = directory.appendingPathComponent((name as NSString).lastPathComponent)
      try? FileManager.default.removeItem(at: target)
      try FileManager.default.copyItem(at: source, to: target)
    }
  }
  #endif

  private func presenter() -> UIViewController? {
    var top = appContext?.utilities?.currentViewController()
    while let presented = top?.presentedViewController, !presented.isBeingDismissed { top = presented }
    return top
  }

  private static func notSupported() -> Exception {
    Exception(name: "NotSupported", description: "Model packs need iOS 26", code: "ERR_NOT_SUPPORTED")
  }
}

private struct Manifest: Decodable {
  let files: [String]
}
