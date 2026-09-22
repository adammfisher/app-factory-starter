import type { ExpoConfig } from 'expo/config';

// Per app, change: name, slug, scheme, bundleIdentifier, package. Nothing else is required.
const config: ExpoConfig = {
  name: 'Tip Split',
  slug: 'tip-split',
  version: '0.1.0',
  scheme: 'tipsplit',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    bundleIdentifier: 'com.visudo.tipsplit',
    supportsTablet: true,
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: 'com.visudo.tipsplit',
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: true,
  },
  web: {
    bundler: 'metro',
    output: 'static',
  },

  plugins: [
    'expo-router',
    [
      'expo-build-properties',
      {
        android: { compileSdkVersion: 36, targetSdkVersion: 36, minSdkVersion: 24, buildToolsVersion: '36.0.0' },
        ios: { deploymentTarget: '15.1' },
      },
    ],
  ],
  experiments: { typedRoutes: true },
};

export default config;
