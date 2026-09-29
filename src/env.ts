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

export const env = Object.freeze({} satisfies Record<string, string>);
