import ExpoModulesCore
#if canImport(FoundationModels)
import FoundationModels
#endif

// Apple's on-device model (Foundation Models, iOS 26 with Apple Intelligence turned on). Where it
// is missing, isAvailableAsync resolves false and the block falls back to the downloaded model.
public class AiBuiltinModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AiBuiltin")

    AsyncFunction("isAvailableAsync") { () -> Bool in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) { return SystemLanguageModel.default.isAvailable }
      #endif
      return false
    }

    AsyncFunction("generateAsync") { (instructions: String, input: String) async throws -> String in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        guard SystemLanguageModel.default.isAvailable else {
          throw Exception(name: "NoModel", description: "The on-device model is not available", code: "ERR_NO_MODEL")
        }
        let session = LanguageModelSession(instructions: instructions)
        return try await session.respond(to: input).content
      }
      #endif
      throw Exception(name: "NoModel", description: "The on-device model needs iOS 26", code: "ERR_NO_MODEL")
    }
  }
}
