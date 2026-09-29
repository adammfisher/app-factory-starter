# The AI block's native half: Apple's on-device model and the Apple-hosted model pack.
Pod::Spec.new do |s|
  s.name           = 'BlockAi'
  s.version        = '1.0.0'
  s.summary        = 'On-device language model and store-hosted model download.'
  s.homepage       = 'https://github.com/adammfisher/app-factory-starter'
  s.license        = 'UNLICENSED'
  s.author         = 'App factory'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.weak_frameworks = 'FoundationModels', 'BackgroundAssets'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files   = '**/*.swift'
end
