<!-- GENERATED from PRD.md by factory/prd.mjs. Do not edit: change the PRD, then run npm run factory:spec. prd-sha256: 6359c8a4b25481ad42120b034caca10639fd72b0d40722cdc37a35b6e311f531 -->
# SPEC — Starter Blocks

Platforms: ios, android, web. Every flow must work on each of them.

## What it is
Give every Visudo app a set of tested, removable building blocks for storage, files, purchases, camera, imaging, PDF, text, AI and app lock, so each new app spends its build budget on its own features instead of rebuilding the same services.

## Flows (build in this order)
### R-001 · blocks.core.conventions · Block conventions
Each block lives in its own folder under src/blocks with the same parts, never imports another block, and can be removed from an app with one command.
Acceptance:
- Every folder in src/blocks has index.ts, index.web.ts, fake.ts, config.js and a block.json listing its name, packages, EXPO_PUBLIC values and device checks; a folder missing any of these fails the conventions test.
- A file inside one block that imports from another block's folder fails the conventions test.
- app.config.ts includes a block's config plugins, permission texts and privacy manifest entries only when that block's folder exists.
- When EXPO_PUBLIC_USE_FAKES is "1", each block's index returns its fake instead of the real implementation.
- node src/blocks/remove.mjs camera deletes src/blocks/camera and spec/blocks/camera and uninstalls each package that no remaining block lists.
- node src/blocks/remove.mjs with a name that is not a block prints "No block named" followed by the name and changes nothing.

### R-002 · blocks.core.lab · Block Lab
A Block Lab screen, available only when EXPO_PUBLIC_BLOCK_LAB is "1", lists each block present and runs its device checks against the real implementation, so a person can prove on a phone that every block works.
Acceptance:
- With EXPO_PUBLIC_BLOCK_LAB set to "1" the Block Lab route shows the block list; with any other value it shows "Not available".
- The list has one row per folder in src/blocks, in alphabetical order, each showing the device checks named in its block.json.
- Run on a row runs that block's checks in order and shows Pass or Fail for each, with the error text for each Fail.
- A check still running after 60 seconds by the screen's timer shows Fail with "Timed out", and the next check starts.
- Run All runs every block's checks and shows the totals passed and failed.
- A block whose block.json lists no device checks shows "No device checks".

### R-003 · blocks.storage.records · Storage block
The storage block keeps JSON records in named collections, settings as key-value pairs and binary files such as images on the device, reports space, and exports or imports everything as one archive.
Acceptance:
- A record saved with id "d1" in collection "docs" is returned by get and by list after the store is closed and reopened, and after remove it is returned by neither.
- list returns a collection's records in the order they were first saved.
- A setting written as sort "name" reads back "name" after the store is reopened, and a setting never written reads as the default passed in.
- Saving 3 files and deleting 1 leaves 2, and usedBytes falls by the deleted file's size.
- A write that would leave less free space than the limit the app sets returns the error "not-enough-space" and writes nothing.
- importArchive of an exportArchive file restores every record, setting and file; into a store that has records it skips ids already present and returns the added and skipped counts; a file that is not an archive returns "not-an-archive" and changes nothing.

### R-004 · blocks.files.exchange · Files block
The files block shares a file through the phone's share sheet, prints a PDF, saves a file to a place the person picks, and opens files the person picks.
Acceptance:
- share(path) opens the share sheet with that file and resolves "shared" or "cancelled".
- print(path) opens the print dialog with that PDF and resolves "printed" or "cancelled".
- saveAs(path, name) opens the phone's save dialog with that name suggested and resolves "saved" or "cancelled".
- open(types, limit) resolves the chosen files in the order chosen, each with its path, name and type, and resolves an empty list when cancelled.
- Files whose type is not in types, and files beyond limit, are left out and counted as skipped.
- On web, share and saveAs download the file and print opens the browser's print dialog.

### R-005 · blocks.purchases.unlock · Purchases block
The purchases block sells one-time unlocks through RevenueCat, keeps a single list of paid features, and tells the app which features are unlocked, online or offline.
Acceptance:
- isUnlocked("pro") is false until the store reports the "pro" entitlement, then true without a restart.
- The paid feature list is declared once, and lockedFeatures() returns every listed feature while "pro" is missing and none once it is present.
- price("pro") returns the store's localized price text, or null when the store cannot be reached, the EXPO_PUBLIC key is missing, or on web.
- buy("pro") resolves "purchased", "cancelled", "pending" or "failed", only "purchased" unlocks, and on web it resolves "failed".
- restore() unlocks "pro" when the store reports an earlier purchase and resolves "nothing-to-restore" otherwise.
- After an unlock, isUnlocked("pro") stays true after a restart while the store cannot be reached.

### R-006 · blocks.camera.capture · Camera block
The camera block scans documents with the phone's document camera, which finds page edges and corrects perspective, and imports photos, returning page images in order.
Acceptance:
- scanDocument() resolves the captured pages in capture order, each with its file path, width and height.
- A cancelled scan resolves an empty list and no error.
- When camera permission is denied, scanDocument() resolves the error "camera-denied", and openSettings() opens the app's page in the phone's settings.
- importPhotos(limit) resolves the chosen images in the order chosen, keeps at most limit of them, and reports how many were dropped.
- HEIC images are converted to JPEG before they are returned.
- On web, scanDocument() resolves the error "not-available", and importPhotos uses the browser's file picker.

### R-007 · blocks.imaging.process · Imaging block
The imaging block changes page images on the device with the filters original, color, grayscale and blackwhite, crop, split in half, stack two images, and resize with JPEG compression, always writing a new file.
Acceptance:
- Applying "grayscale" to a 4 × 4 test image returns a new image whose pixels have equal red, green and blue values, and the input file is unchanged.
- Applying "blackwhite" returns a new image whose pixels are only pure black or pure white, and "original" returns the input unchanged.
- crop(image, rect) returns an image exactly the rect's size, and a rect reaching outside the image returns the error "bad-rect".
- splitHalves(image) returns the left half then the right half, and their widths add up to the original width.
- stack(top, bottom) returns one image as tall as both together and as wide as the wider one.
- resize(image, 1600, 0.4) returns a JPEG whose longest side is 1600 pixels when the input is larger, and leaves a smaller image at its own size.

### R-008 · blocks.pdf.write · PDF block
The pdf block writes multi-page PDFs from page images on the device, with an optional invisible text layer, a page size and a password, and reads text back out of a PDF.
Acceptance:
- write of 3 page images produces one PDF with 3 pages in the given order.
- With the text "Invoice 4417" given for page 2, readText of the PDF returns "Invoice 4417" for page 2.
- Page size "letter" gives pages of 612 × 792 points, "a4" gives 595 × 842 points, and "auto" gives each page its image's aspect ratio.
- With a password of 4 to 64 characters, readText without the password returns the error "password-required", and with it returns the text.
- A password shorter than 4 or longer than 64 characters, or an empty list of pages, returns an error and writes no file.

### R-009 · blocks.text.recognize · Text block
The text block reads the text in an image on the device, and translates text into another language on the device, reporting which languages are available.
Acceptance:
- recognize(image) returns the text lines in reading order, top to bottom, and an image with no text returns an empty list.
- languages() returns the languages the phone's translator supports, each with its code and whether it is downloaded.
- translate(text, "es") returns the translated text, and a language not yet downloaded resolves "needs-download".
- downloadLanguage("es") shows the phone's download prompt and resolves "downloaded" or "declined".
- Empty text returns an empty result without calling the recognizer or the translator.
- The block makes no network calls of its own, and on web recognize and translate resolve the error "not-available".

### R-010 · blocks.ai.generate · AI block
The AI block runs a language model on the phone, choosing the phone's built-in model when there is one and otherwise a downloaded model, and offers generate and summarize.
Acceptance:
- status() returns "builtin" when the phone reports Apple's or Google's on-device model, "downloaded" when the model file is present, "downloadable" when neither is present and the phone has 6 GB of memory or more, and "unavailable" otherwise.
- generate(instructions, input) returns the model's text, and resolves the error "no-model" when status is "downloadable" or "unavailable".
- generate with input longer than 2,000 words resolves the error "too-long" and sends nothing to the model.
- summarize of a 5,000-word text sends parts of 2,000, 2,000 and 1,000 words, then one request that combines the three part summaries, and returns that combined summary.
- The block makes no network calls while generating or summarizing.
- On web, status() returns "unavailable".

### R-011 · blocks.ai.model · AI model download
The AI block downloads its model from the app store's hosted downloads on phones that need it, reports progress, waits for Wi-Fi on large downloads unless the person agrees, and removes the model on request.
Acceptance:
- download() resolves "not-needed" when status is "builtin" or "downloaded", and "not-supported" when status is "unavailable".
- download() reports progress in whole percent from 0 to 100 and ends with status "downloaded".
- A download larger than 200 MB on mobile data reports "waiting-for-wifi" until Wi-Fi returns or the person accepts the phone's mobile-data prompt.
- A failed or cancelled download leaves status "downloadable" and no partial files.
- remove() deletes the model files, sets status to "downloadable", and returns the bytes freed.

### R-012 · blocks.lock.biometric · Lock block
The lock block asks for Face ID, Touch ID, a fingerprint or the phone passcode, and tells the app when to lock again and when to hide its content.
Acceptance:
- authenticate() resolves "success", "cancelled" or "unavailable", and offers the phone passcode when biometrics fail.
- With a 60-second grace period, shouldLock returns true after 60 or more seconds in the background and false after 59 seconds.
- The grace period accepts 0 to 600 seconds; a value below 0 becomes 0 and a value above 600 becomes 600.
- When the app state changes to inactive or background with lock enabled, the block emits "hide-content" in that same state change.
- On web, authenticate() resolves "unavailable".

## Rules and invariants
- A block never imports another block. Apps compose blocks; blocks compose nothing.
- Each block has a real implementation (index.ts), a web fallback (index.web.ts) and a fake (fake.ts) whose results tests can set.
- Blocks return results and error codes for expected outcomes such as cancel, denied and not available. They throw only for programming errors.
- No block holds user-facing text. Any text a person sees comes from the app's src/strings.ts.
- Blocks keep user content on the device. Only the purchases block (RevenueCat) and the AI model download (store-hosted) use the network, and no block sends user content anywhere.
- Custom native code is reached through requireOptionalNativeModule, so a missing native module reads as "not-available" instead of crashing.
- Each block declares its own packages, config plugins, permission texts, privacy manifest entries and EXPO_PUBLIC values inside its folder. Nothing about a block lives outside that folder except its tests.
- After promotion into the starter, block tests live in spec/blocks, outside features.json.
- The Block Lab and the fakes are switched on only by EXPO_PUBLIC values, never by editing code.

## What can't be undone
- Promoting the blocks into the starter changes every app created from it afterwards.
- Purchases made from the Block Lab must use store sandbox accounts; a purchase on a real account charges real money.

## Dependencies
- Starter v3.1 (commit 6126c4e) merged into main.
- EAS development builds for iOS and Android.
- Real phones for the Block Lab: an iPhone 15 Pro or newer and a Gemini Nano phone such as a Pixel 9 to check built-in models, and any phone with 6 GB of memory or more for the downloaded model.
- A RevenueCat sandbox project with the entitlement "pro" and test products, an Apple sandbox tester and a Google Play licence tester.
- A GGUF build of MiniCPM-V 4.6 (Apache 2.0) for the downloaded-model path.
- App Store Connect and Play Console access to upload model asset packs.

## Out of scope
- Analytics, crash reporting, notifications, sign-in, cloud sync, subscriptions and ads.
- Screens other than the Block Lab. Paywalls, lock screens and document libraries are app code.
- ScanOnce's own features.

## Decisions
- 2026-09-28 · R-001 · Building blocks are added to the starter now and built test-first through the loop, rather than waiting until a second app needs them (owner).
- 2026-09-28 · R-001 · app.config.ts composes the config.js of every folder present in src/blocks, so removing a folder removes its config (chat).
- 2026-09-28 · R-002 · EXPO_PUBLIC_BLOCK_LAB is "1" in the development EAS environment, EXPO_PUBLIC_USE_FAKES is "1" in the preview environment used by e2e-test builds, and neither is set in production (chat).
- 2026-09-28 · R-008 · Phones write PDFs natively, one page at a time, with PDFKit on iOS and PdfBox-Android on Android; pdf-lib is the web and test implementation (chat).
- 2026-09-28 · R-010 · Apple's Foundation Models and Google's Gemini Nano are reached through native bridges built in the native session; the downloaded model runs through llama.rn (chat).
- 2026-09-28 · R-011 · The model ships as Apple-hosted asset packs and Google Play AI packs, split in two when larger than 1.5 GB (chat).

## Assumptions (defaults nobody has confirmed yet)
- M-01 · ScanOnce uses all 9 blocks and changes no more than 50 lines in them (default, unconfirmed).
- R-001 · Blocks ship in the starter and each app removes the ones it does not need, rather than adding them one at a time (default, unconfirmed).
- R-001 · Blocks are built on a branch named blocks-v1 of the starter, and merged into main only after every device check passes (default, unconfirmed).
- R-010 · The downloaded-model path uses MiniCPM-V 4.6 through llama.cpp (default, unconfirmed).
- R-012 · The default grace period is 60 seconds (default, unconfirmed).
