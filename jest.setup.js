// React Native Testing Library registers its cleanup hooks when it is first required. A spec that
// requires it inside a test, after jest.resetModules() (spec/F011), would register them mid-test,
// which Jest rejects. So the library's automatic setup is off and done once here instead.
process.env.RNTL_SKIP_AUTO_CLEANUP = 'true';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await require('@testing-library/react-native').cleanup();
});
