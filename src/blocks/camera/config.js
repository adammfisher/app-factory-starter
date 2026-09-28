// The camera block's share of app.config.ts. iOS shows these texts the first time the app asks for
// the camera or the photo library; Android's permissions come from the plugin. Photos are chosen
// with the system photo picker, so the app never reads the whole library.
const cameraPermission = 'Scan documents with the camera.';
const photosPermission = 'Import photos you choose.';

module.exports = {
  plugins: [['expo-image-picker', { cameraPermission, photosPermission, microphonePermission: false }]],
  ios: {
    infoPlist: { NSCameraUsageDescription: cameraPermission, NSPhotoLibraryUsageDescription: photosPermission },
    privacyManifests: { NSPrivacyAccessedAPITypes: [] },
  },
};
