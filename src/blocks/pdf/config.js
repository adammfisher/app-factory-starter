// The pdf block's share of app.config.ts: nothing. It reads page images and writes PDFs in the
// app's own folders, which needs no permission, and builds the PDF in JavaScript.
module.exports = {
  plugins: [],
  ios: {
    infoPlist: {},
    privacyManifests: { NSPrivacyAccessedAPITypes: [] },
  },
};
