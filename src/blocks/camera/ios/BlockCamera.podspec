# The camera block's native half: Apple's VisionKit document camera.
Pod::Spec.new do |s|
  s.name           = 'BlockCamera'
  s.version        = '1.0.0'
  s.summary        = 'Scan document pages with the phone camera.'
  s.homepage       = 'https://github.com/adammfisher/app-factory-starter'
  s.license        = 'UNLICENSED'
  s.author         = 'App factory'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'VisionKit', 'AVFoundation'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files   = '**/*.swift'
end
