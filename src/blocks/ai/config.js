// The AI block's share of app.config.ts. llama.rn's plugin sets the build flags it needs and, in
// production builds, the iOS entitlements that let the app use more memory for the model. The
// model runs on the phone, so there is nothing to ask permission for.
module.exports = {
  plugins: ['llama.rn'],
  ios: {
    infoPlist: {},
    privacyManifests: { NSPrivacyAccessedAPITypes: [] },
  },
};
