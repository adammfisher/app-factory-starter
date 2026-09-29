import ExpoModulesCore
import NaturalLanguage
import SwiftUI
import UIKit
#if canImport(Translation)
import Translation
#endif

// Apple's Translation, on the device. Languages are listed and downloaded relative to the phone's
// own language; the text's language is detected when translating. Needs iOS 18; before that the
// phone reports no languages.
public class TranslatorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Translator")

    AsyncFunction("languagesAsync") { () async -> [[String: Any]] in
      #if canImport(Translation)
      if #available(iOS 18.0, *) { return await Languages.list() }
      #endif
      return []
    }

    AsyncFunction("translateAsync") { (text: String, code: String) async throws -> String in
      #if canImport(Translation)
      if #available(iOS 18.0, *) {
        return try await Languages.translate(text, into: code, presenter: { await self.presenter() })
      }
      #endif
      throw Exception(name: "NotSupported", description: "Translation needs iOS 18", code: "ERR_NOT_SUPPORTED")
    }

    AsyncFunction("downloadAsync") { (code: String) async throws -> Bool in
      #if canImport(Translation)
      if #available(iOS 18.0, *) {
        guard let presenter = await self.presenter() else {
          throw Exception(name: "NoView", description: "Nothing to present from", code: "ERR_NO_VIEW")
        }
        return await Languages.download(code, presenter: presenter)
      }
      #endif
      throw Exception(name: "NotSupported", description: "Translation needs iOS 18", code: "ERR_NOT_SUPPORTED")
    }
  }

  @MainActor
  private func presenter() -> UIViewController? {
    var top = appContext?.utilities?.currentViewController()
    while let presented = top?.presentedViewController, !presented.isBeingDismissed { top = presented }
    return top
  }
}

#if canImport(Translation)
@available(iOS 18.0, *)
enum Languages {
  static var phone: Locale.Language { Locale.current.language }

  static func code(_ language: Locale.Language) -> String { language.minimalIdentifier }

  static func same(_ a: Locale.Language, _ b: Locale.Language) -> Bool {
    a.languageCode == b.languageCode && (a.script == nil || b.script == nil || a.script == b.script)
  }

  static func list() async -> [[String: Any]] {
    let availability = LanguageAvailability()
    var seen = Set<String>()
    var out: [[String: Any]] = []
    for language in await availability.supportedLanguages {
      let id = code(language)
      guard seen.insert(id).inserted else { continue }
      let downloaded = same(language, phone) ? true : await availability.status(from: phone, to: language) == .installed
      out.append(["code": id, "downloaded": downloaded])
    }
    return out.sorted { ($0["code"] as? String ?? "") < ($1["code"] as? String ?? "") }
  }

  // The text's own language, or the phone's when it cannot be told.
  static func detect(_ text: String) -> Locale.Language {
    guard let found = NLLanguageRecognizer.dominantLanguage(for: text) else { return phone }
    return Locale.Language(identifier: found.rawValue)
  }

  static func translate(_ text: String, into code: String, presenter: () async -> UIViewController?) async throws -> String {
    let target = Locale.Language(identifier: code)
    let source = detect(text)
    if same(source, target) { return text }
    let status = await LanguageAvailability().status(from: source, to: target)
    if status == .unsupported {
      throw Exception(name: "NotSupported", description: "Cannot translate into \(code)", code: "ERR_NOT_SUPPORTED")
    }
    if status != .installed {
      throw Exception(name: "NeedsDownload", description: "Language \(code) is not downloaded", code: "ERR_NEEDS_DOWNLOAD")
    }
    if #available(iOS 26.0, *) {
      return try await TranslationSession(installedSource: source, target: target).translate(text).targetText
    }
    guard let view = await presenter() else {
      throw Exception(name: "NoView", description: "Nothing to present from", code: "ERR_NO_VIEW")
    }
    return try await SessionHost.run(source: source, target: target, in: view) { session in
      try await session.translate(text).targetText
    }
  }

  // Shows the phone's download prompt; true once the language is on the phone.
  static func download(_ code: String, presenter: UIViewController) async -> Bool {
    let target = Locale.Language(identifier: code)
    if same(target, phone) { return true }
    let availability = LanguageAvailability()
    if await availability.status(from: phone, to: target) == .installed { return true }
    _ = try? await SessionHost.run(source: phone, target: target, in: presenter) { session in
      try await session.prepareTranslation()
    }
    return await availability.status(from: phone, to: target) == .installed
  }
}

// Before iOS 26 a translation session only comes from SwiftUI's translationTask, so an invisible
// SwiftUI view is added to the screen for the length of one call.
@available(iOS 18.0, *)
enum SessionHost {
  @MainActor
  static func run<T>(source: Locale.Language, target: Locale.Language, in presenter: UIViewController,
                     _ action: @escaping (TranslationSession) async throws -> T) async throws -> T {
    try await withCheckedThrowingContinuation { continuation in
      var host: UIHostingController<SessionView>?
      let view = SessionView(configuration: .init(source: source, target: target)) { session in
        do {
          continuation.resume(returning: try await action(session))
        } catch {
          continuation.resume(throwing: error)
        }
        await MainActor.run {
          host?.willMove(toParent: nil)
          host?.view.removeFromSuperview()
          host?.removeFromParent()
          host = nil
        }
      }
      let controller = UIHostingController(rootView: view)
      host = controller
      controller.view.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
      controller.view.alpha = 0.01
      controller.view.isUserInteractionEnabled = false
      presenter.addChild(controller)
      presenter.view.addSubview(controller.view)
      controller.didMove(toParent: presenter)
    }
  }
}

@available(iOS 18.0, *)
struct SessionView: View {
  let configuration: TranslationSession.Configuration
  let action: (TranslationSession) async -> Void
  var body: some View {
    Color.clear.translationTask(configuration) { session in await action(session) }
  }
}
#endif
