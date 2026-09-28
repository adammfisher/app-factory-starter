// The files block's share of app.config.ts. Files are chosen with the system document picker and
// handed over through the system's own share sheet, print dialog and save dialog, so the app never
// asks for access to storage. expo-document-picker's plugin only adds iCloud entitlements, which
// need an iCloud container, so it is left out.
module.exports = {
  plugins: [],
  ios: {
    infoPlist: {},
    privacyManifests: { NSPrivacyAccessedAPITypes: [] },
  },
};
