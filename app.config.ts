import type { ExpoConfig } from 'expo/config';

// Per app, change the identity block and the files in assets/. Nothing else is required.
const identity = {
  name: 'Tip Split',
  slug: 'tip-split',
  scheme: 'tipsplit',
  bundleIdentifier: 'com.visudo.tipsplit',
  package: 'com.visudo.tipsplit',
  version: '0.1.0',
  colors: {
    primary: '#2563EB',
    // Copied from src/theme.ts (light and dark background) as hex: the config loader cannot
    // import TypeScript files, and Android resources accept only hex.
    splashLight: '#FFFFFF',
    splashDark: '#000000',
  },
  // From `eas init`. Empty until the app has an EAS project.
  easProjectId: '',
  // Phone-first: no iPad screenshots or iPad review. Set true to ship an iPad layout.
  supportsTablet: false,
};

const config: ExpoConfig = {
  name: identity.name,
  slug: identity.slug,
  version: identity.version,
  scheme: identity.scheme,
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: identity.bundleIdentifier,
    supportsTablet: identity.supportsTablet,
    config: { usesNonExemptEncryption: false },
    // Required-reason APIs used by React Native and the linked Expo modules, copied from each
    // package's PrivacyInfo.xcprivacy. A new native package: add its entries here.
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        {
          // react-native, RCT-Folly, boost, glog (C617.1); expo-file-system (0A2A.1, 3B52.1)
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
          NSPrivacyAccessedAPITypeReasons: ['C617.1', '0A2A.1', '3B52.1'],
        },
        {
          // react-native, expo-constants, expo-system-ui
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
        {
          // boost
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime',
          NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
        },
        {
          // expo-file-system
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace',
          NSPrivacyAccessedAPITypeReasons: ['E174.1', '85F4.1'],
        },
      ],
    },
  },
  android: {
    package: identity.package,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      monochromeImage: './assets/adaptive-icon-monochrome.png',
      backgroundColor: identity.colors.primary,
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: true,
  },
  web: {
    bundler: 'metro',
    output: 'static',
    favicon: './assets/favicon.png',
  },

  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: identity.colors.splashLight,
        dark: { backgroundColor: identity.colors.splashDark },
      },
    ],
    [
      'expo-build-properties',
      {
        android: { compileSdkVersion: 36, targetSdkVersion: 36, minSdkVersion: 24, buildToolsVersion: '36.0.0' },
        ios: { deploymentTarget: '15.1' },
      },
    ],
  ],
  experiments: { typedRoutes: true },
  ...(identity.easProjectId ? { extra: { eas: { projectId: identity.easProjectId } } } : {}),
};

export default config;
