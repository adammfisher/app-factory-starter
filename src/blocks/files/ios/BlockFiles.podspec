# The files block's native half: the share sheet, print dialog and save dialog.
Pod::Spec.new do |s|
  s.name           = 'BlockFiles'
  s.version        = '1.0.0'
  s.summary        = 'Share, print and save a file with the system sheets.'
  s.homepage       = 'https://github.com/adammfisher/app-factory-starter'
  s.license        = 'UNLICENSED'
  s.author         = 'App factory'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files   = '**/*.swift'
end
