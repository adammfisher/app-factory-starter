// The imaging block's share of app.config.ts: nothing. It reads and writes the app's own cache
// folder, which needs no permission, and decodes pixels in JavaScript.
module.exports = {
  plugins: [],
  ios: {
    infoPlist: {},
    privacyManifests: { NSPrivacyAccessedAPITypes: [] },
  },
};
