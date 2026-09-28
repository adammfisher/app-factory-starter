// The storage block's share of app.config.ts. Everything is kept in the app's own documents
// directory, so no permission is asked for. Reading the free space before each write is a
// required-reason API on iOS: E174.1 is "check whether there is enough space to write files".
module.exports = {
  plugins: [],
  ios: {
    infoPlist: {},
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [{ NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1'] }],
    },
  },
};
