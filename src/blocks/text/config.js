// The text block's share of app.config.ts. Recognition and translation run on the phone through
// the TextRecognizer and Translator native modules, and the images come from other blocks, so
// there is nothing to ask permission for.
module.exports = {
  plugins: [],
  ios: {
    infoPlist: {},
    privacyManifests: { NSPrivacyAccessedAPITypes: [] },
  },
};
