import ExpoModulesCore
import UIKit
import Vision

// Reads the text in an image with Apple's Vision. Each line comes back with its frame in pixels
// from the image's top-left corner, as the image is shown (its orientation applied).
public class TextRecognizerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TextRecognizer")

    AsyncFunction("recognizeAsync") { (uri: String) throws -> [[String: Any]] in
      let path = uri.hasPrefix("file://") ? (URL(string: uri)?.path ?? uri) : uri
      guard let image = UIImage(contentsOfFile: path), let cgImage = Self.flattened(image) else {
        throw Exception(name: "ImageError", description: "Could not read an image at \(uri)", code: "ERR_IMAGE")
      }
      let width = Double(cgImage.width)
      let height = Double(cgImage.height)

      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      if #available(iOS 16.0, *) { request.automaticallyDetectsLanguage = true }
      try VNImageRequestHandler(cgImage: cgImage, orientation: .up).perform([request])

      return (request.results ?? []).compactMap { observation in
        guard let text = observation.topCandidates(1).first?.string else { return nil }
        // Vision's boxes are 0...1 from the bottom-left corner.
        let box = observation.boundingBox
        return [
          "text": text,
          "frame": [
            "x": box.minX * width,
            "y": (1 - box.maxY) * height,
            "width": box.width * width,
            "height": box.height * height,
          ],
        ]
      }
    }
  }

  // The image as shown, drawn onto white: its orientation applied, and transparent parts (a PNG
  // screenshot or a page rendered from a PDF) made white, which Vision would otherwise read as black.
  static func flattened(_ image: UIImage) -> CGImage? {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let size = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
    guard size.width > 0, size.height > 0 else { return nil }
    return UIGraphicsImageRenderer(size: size, format: format).image { context in
      UIColor.white.setFill()
      context.fill(CGRect(origin: .zero, size: size))
      image.draw(in: CGRect(origin: .zero, size: size))
    }.cgImage
  }
}
