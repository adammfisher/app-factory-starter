// The only module that reads process.env.EXPO_PUBLIC_*. Public values only: they ship inside the
// app bundle. A missing value reads as '' so tests and the web export run without a .env.
//
// To add one: list it in .env.example, create it with `eas env:create`, then add a line below.
// Expo inlines each variable at build time only when it is written out in full, as below;
// never read process.env dynamically.
//
//   revenueCatIosKey: publicValue(process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY),

export function publicValue(value: string | undefined): string {
  return value ?? '';
}

export const env = Object.freeze({
  // "1" turns on the Block Lab screen (app/block-lab.tsx) in development builds.
  blockLab: publicValue(process.env.EXPO_PUBLIC_BLOCK_LAB),
} satisfies Record<string, string>);

// The fakes switch: "1" in the preview environment used by e2e builds. Each block's index calls
// this when it loads and exports its fake instead of the real implementation. A function, not a
// field of env, so a test can set the variable before requiring a block.
export function useFakes(): boolean {
  return process.env.EXPO_PUBLIC_USE_FAKES === '1';
}
