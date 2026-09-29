# The text block's native half: Apple's Vision text recognizer and Apple's Translation.
Pod::Spec.new do |s|
  s.name           = 'BlockText'
  s.version        = '1.0.0'
  s.summary        = 'Read text in images and translate it, on the device.'
  s.homepage       = 'https://github.com/adammfisher/app-factory-starter'
  s.license        = 'UNLICENSED'
  s.author         = 'App factory'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'Vision', 'NaturalLanguage', 'SwiftUI'
  s.weak_frameworks = 'Translation'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files   = '**/*.swift'
end
