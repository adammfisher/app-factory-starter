// The lock block's share of app.config.ts. The Face ID text is shown by iOS the first time the
// app asks for Face ID; Android's biometric permissions come from the plugin.
const faceIDPermission = 'Unlock the app with Face ID.';

module.exports = {
  plugins: [['expo-local-authentication', { faceIDPermission }]],
  ios: {
    infoPlist: { NSFaceIDUsageDescription: faceIDPermission },
    privacyManifests: { NSPrivacyAccessedAPITypes: [] },
  },
};
