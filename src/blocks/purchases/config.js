// The purchases block's share of app.config.ts. RevenueCat needs no config plugin; Google Play's
// billing permission comes from its Android library. The secure-store plugin keeps the kept
// unlocks out of Android backups, where the key that encrypts them does not follow.
module.exports = {
  plugins: ['expo-secure-store'],
  ios: {
    infoPlist: {},
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        {
          // RevenueCat caches the customer record in UserDefaults
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
      ],
    },
  },
};
