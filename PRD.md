# PRD — Paperkeep
- Product: paperkeep
- Owner: Adam Fisher
- Version: 0.1
- Status: ready
- Platforms: ios, android
- Funding: self-funded (Visudo Labs)

## Objective
Sell a document scanner that does everything the 40-dollar-a-year scanners charge for, for a single payment of $9.99, with every scan staying on the phone, so Paperkeep becomes the pay-once scanner people recommend on iPhone and Android.

## Users and journeys
People who keep paper: freelancers and small-business owners with receipts and invoices, families with leases, IDs and tax forms, students with handouts. Today they use the phone's built-in scanner, which makes files they cannot search, or a subscription scanner that charges $4.99 a week or $40 a year, asks for an account and uploads their documents to its cloud. Many search the stores for a scanner with no subscription.
With Paperkeep they scan for free with no limit, no watermark and no account. The first time they want to search their scans, sign a page, translate a letter or summarize a contract, they pay $9.99 once and everything unlocks for good. Their documents never leave the phone unless they share them, and they keep their own backup in Google Drive or iCloud Drive.

## Outcome metrics
### M-01 Pro purchases
- Baseline: 0
- Target: 1,000 Pro purchases across both stores
- Timeframe: 90 days after release
- Measured by: RevenueCat dashboard, count of Pro product purchases on iOS and Android

### M-02 Install-to-Pro conversion
- Baseline: 0
- Target: 5 percent of first-time downloads buy Pro within 30 days of install
- Timeframe: first 90 days after release
- Measured by: RevenueCat Pro purchases divided by first-time downloads in App Store Connect and Google Play Console

### M-03 Store rating
- Baseline: 0 ratings
- Target: average of 4.6 stars or higher, with at least 200 ratings on each store
- Timeframe: 120 days after release
- Measured by: App Store Connect and Google Play Console ratings reports

## Requirements
### R-001 Scan pages into a document
- Key: paperkeep.scan.capture
- Type: new-capability
- Priority: must
- Statement: The person scans one or more pages with the document camera and saves them as one new document.
- Acceptance:
  - When the camera block returns 3 pages and the person taps Save in review, a 3-page document appears first in the library.
  - The new document is named "Scan" plus the capture date and time in the form "Scan 2026-09-28 14.05".
  - Two documents saved in the same minute get the same default name, and both are kept.
  - When the camera block returns an empty list, the app returns to the library, creates nothing and shows no error.
  - When the camera block returns the error "camera-denied", the app shows the camera permission screen and creates nothing.
  - When the camera block returns any other error, the library shows "Could not start the scanner" and nothing is created.

### R-002 Review pages before saving
- Key: paperkeep.scan.review
- Type: new-capability
- Priority: must
- Statement: Before saving, the person reviews the captured pages, removes, reorders or rotates them, and picks a filter.
- Acceptance:
  - Review shows every captured page in capture order with its position, for example "Page 2 of 3".
  - Deleting page 2 of 3 leaves 2 pages, and deleting the only remaining page returns to the library without creating a document.
  - Moving the last page up one place, then saving, stores the pages in the new order.
  - Rotate turns the selected page 90 degrees clockwise on each tap, and four taps return it to its original orientation.
  - Each page offers the filters Original, Color, Grayscale and Black and White, with Original selected until the person picks another, and Apply to All sets the chosen filter on every page.
  - Cancel opens an in-app confirmation; Keep Editing stays in review, and Discard returns to the library without creating a document.

### R-003 Recover an unsaved scan
- Key: paperkeep.scan.recover
- Type: new-capability
- Priority: must
- Statement: Pages that were captured but not yet saved survive the app closing, so no scan is ever lost.
- Acceptance:
  - Each page is written through the storage block as soon as the camera block returns it, before review opens.
  - When the app is closed after 2 pages are captured and before Save, the next launch lists a document named "Unsaved scan" with those 2 pages at the top of the library.
  - Opening "Unsaved scan" returns to review with the pages, order, rotation and filters as they were left.
  - Saving a recovered scan names the document with its original capture date and time, not the time it was recovered.
  - Discarding a recovered scan, after the in-app confirmation, deletes its pages from the device.

### R-004 Import photos and files
- Key: paperkeep.scan.import
- Type: new-capability
- Priority: should
- Statement: The person turns photos or image files already on the phone into a document.
- Acceptance:
  - Choosing 4 images in the photo picker opens review with 4 pages in the order chosen.
  - Choosing JPEG, PNG or HEIC files through the file picker opens review with those pages in the order chosen.
  - Files that are not JPEG, PNG or HEIC images are skipped, and an inline message states how many, for example "2 files skipped".
  - Cancelling either picker, or choosing nothing, returns to the library and creates nothing.
  - Choosing more than 200 images keeps the first 200 and shows "Only the first 200 pages were added".
  - Import is free and never opens the paywall.

### R-005 Scan modes
- Key: paperkeep.scan.modes
- Type: new-capability
- Priority: should
- Statement: With Pro, the person picks a scan mode that shapes the saved pages: Document, Receipt, ID Card, Whiteboard or Book.
- Acceptance:
  - Document is selected on first use, and the last mode chosen is kept after a restart.
  - ID Card asks for the front and then the back, and saves both sides on one page, front above back.
  - Book splits each captured image into its left and right halves, left first, so 3 captures save 6 pages.
  - Receipt saves pages with the Black and White filter and names the document "Receipt" plus the capture date and time.
  - Whiteboard saves pages with the Color filter and names the document "Whiteboard" plus the capture date and time.
  - Without Pro, choosing any mode other than Document opens the paywall and keeps Document selected.

### R-006 Camera permission and first scan
- Key: paperkeep.scan.permission
- Type: new-capability
- Priority: must
- Statement: The first time the person scans, a short explainer says scans stay on the phone before the system asks for camera access, and a denied permission has a clear way back.
- Acceptance:
  - On the first tap of Scan, an explainer shows "Your scans stay on this phone" and a Continue button before the camera block is called.
  - After the explainer has been shown once, later taps of Scan call the camera block directly, including after a restart.
  - When camera access is denied, the permission screen shows "Camera access is off" and an Open Settings button that calls the camera block's openSettings.
  - The iOS camera permission text is "Used to scan your documents. Scans stay on your device."
  - The iOS photo library permission text is "Used to import photos you choose." and the Face ID permission text is "Used to lock your documents."
  - Import from photos stays available while camera access is denied.

### R-007 Library
- Key: paperkeep.library.browse
- Type: new-capability
- Priority: must
- Statement: The library lists every folder and document, with each document's first-page thumbnail, name, date, page count and category.
- Acceptance:
  - Before any document exists, the library shows "No scans yet" and a Scan button, and shows no search box or sort control.
  - Each document row shows the first page's thumbnail, the name, the date in the form "Sep 28, 2026", and the page count as "1 page" or "3 pages".
  - With Pro, a document that has a category also shows the category name on its row.
  - Tapping a document row opens that document's viewer.
  - Folders are listed above documents, each with its name and document count.
  - The Scan and Import buttons are shown on the library whether it is empty or not.

### R-008 Sort and filter
- Key: paperkeep.library.sort
- Type: new-capability
- Priority: should
- Statement: The person chooses how the library is sorted and, with Pro, filters it by category.
- Acceptance:
  - On first use, documents are sorted newest first.
  - Sort offers Newest, Oldest, Name A to Z and Name Z to A, and name sorting ignores upper and lower case.
  - Documents with the same name keep newest-first order among themselves under either name sort.
  - The chosen sort is kept after a restart.
  - With Pro, choosing a category shows only that category's documents, each category shows its count, and All clears the filter.
  - A category with no documents is not offered in the filter.

### R-009 Rename a document
- Key: paperkeep.library.rename
- Type: new-capability
- Priority: must
- Statement: The person renames a document from the library or the viewer.
- Acceptance:
  - Rename opens with the current name filled in.
  - A new name of 1 to 80 characters, after removing spaces at either end, is saved and shown in the library and the viewer.
  - An empty name, or one made only of spaces, shows "Name can't be empty" and keeps the old name.
  - A name longer than 80 characters shows "Name is too long" and keeps the old name.
  - Cancel keeps the old name.
  - Two documents may have the same name.

### R-010 Delete documents
- Key: paperkeep.library.delete
- Type: new-capability
- Priority: must
- Statement: The person deletes one or several documents after confirming, and every trace of them leaves the device.
- Acceptance:
  - Delete opens an in-app confirmation that names the document.
  - Cancel keeps the document; Delete removes it, its pages and its recognized text from the device.
  - After deletion, the library no longer lists the document and search no longer finds it.
  - Deleting 3 selected documents shows "Delete 3 documents?" and removes all 3 on confirmation.
  - The space used shown in Settings falls by the deleted documents' size.

### R-011 Folders
- Key: paperkeep.library.folders
- Type: new-capability
- Priority: should
- Statement: The person groups documents into folders one level deep.
- Acceptance:
  - A folder name of 1 to 40 characters creates a folder, listed above documents.
  - A name matching an existing folder, ignoring upper and lower case and spaces at either end, shows "That folder already exists" and creates nothing.
  - Moving a document into a folder lists it only inside that folder, and the folder's count rises by one.
  - Renaming a folder follows the same length and duplicate rules as creating one.
  - Deleting a folder opens an in-app confirmation, moves its documents back to the main library, and deletes no document.
  - A folder cannot hold another folder.

### R-012 Select several documents
- Key: paperkeep.library.select
- Type: new-capability
- Priority: should
- Statement: The person selects several documents at once to move, share, merge or delete them.
- Acceptance:
  - A long press on a document row starts selection, marks that row and shows "1 selected".
  - While selecting, tapping a row adds or removes it, and Select All selects every document in the current view.
  - The selection bar offers Move, Share, Merge and Delete, and Merge is available only with 2 or more selected.
  - Share with 3 documents selected shares 3 PDFs.
  - Done, or removing the last selected row, ends selection.

### R-013 Document viewer
- Key: paperkeep.document.view
- Type: new-capability
- Priority: must
- Statement: The person opens a document to page through it and reach every action for it.
- Acceptance:
  - Opening a document shows its first page and "Page 1 of 3" for a 3-page document.
  - Swiping to the next page shows it and updates the position, and swiping on the last page stays on the last page.
  - The viewer offers Export, Share, Print, Rename, Move, Delete and Add Pages to every user.
  - Without Pro, the viewer's Text, Translate, Sign, Summarize and Ask actions show a lock badge.
  - Deleting from the viewer returns to the library after the confirmation.

### R-014 Export and share
- Key: paperkeep.export.share
- Type: new-capability
- Priority: must
- Statement: The person exports a document as a PDF or as JPG images and sends it to any app through the share sheet, with no watermark.
- Acceptance:
  - Exporting a 3-page document as PDF produces one PDF with 3 pages, named after the document.
  - Exporting it as JPG produces 3 images named after the document and numbered 1 to 3.
  - Page size offers Auto, Letter and A4; Auto is selected on first use and the last choice is kept after a restart.
  - No exported file contains a watermark, a logo or any text the person did not scan or type.
  - Slashes, colons and other characters not allowed in file names are replaced with hyphens in exported file names.
  - Cancelling the share sheet leaves the document unchanged and shows no error.

### R-015 Print
- Key: paperkeep.export.print
- Type: new-capability
- Priority: should
- Statement: The person prints a document from the viewer.
- Acceptance:
  - Print sends the document's PDF, at the chosen page size, to the files block's print.
  - Cancelling the print dialog shows no error.
  - Print is free and never opens the paywall.

### R-016 Compress exports
- Key: paperkeep.export.compress
- Type: new-capability
- Priority: should
- Statement: With Pro, the person makes exported files smaller and sees the size of each choice before exporting.
- Acceptance:
  - Compression offers High, Medium and Small, and High is selected on first use.
  - Small, Medium and High use JPEG quality 0.4, 0.6 and 0.85 and a longest page side of 1,600, 2,200 and 3,000 pixels.
  - Each choice shows its estimated file size before export, in MB with one decimal place.
  - The last compression choice is kept after a restart.
  - Without Pro, exports use High, and choosing Medium or Small opens the paywall.

### R-017 Pro feature list and locks
- Key: paperkeep.pro.locks
- Type: new-capability
- Priority: must
- Statement: One list names every Pro feature, and every locked control, the paywall and Settings read that list.
- Acceptance:
  - The Pro feature list is declared once and names text and search, searchable PDFs, translation, scan modes, merge, extract and split, compression, signing, automatic names and categories, App Lock, PDF passwords, and AI summaries and questions.
  - While Pro is locked, every control for a listed feature shows a lock badge, and tapping it opens the paywall with that feature named at the top.
  - After an unlock, no lock badge is shown anywhere, without a restart.
  - Scanning, saving, importing, exporting at High, printing, folders, sharing and backup never show a lock badge or open the paywall.
  - Settings lists every Pro feature under "Included with Pro", each with a check mark once Pro is unlocked.

### R-018 Paywall
- Key: paperkeep.pro.paywall
- Type: new-capability
- Priority: must
- Statement: The paywall explains the one-time purchase and offers Buy, Restore and the legal links.
- Acceptance:
  - The paywall shows "Pay once. Yours forever.", every entry of the Pro feature list and "One-time purchase. No subscription."
  - The price shown is the one the purchases block returns; when it returns none, the paywall shows "Store not available" and Buy is disabled.
  - The paywall never opens by itself before the first document is saved.
  - Close is always visible and returns to the screen the paywall was opened from.
  - The paywall shows Restore Purchases, Privacy Policy and Terms links.
  - While a purchase is in progress, Buy shows a progress indicator and cannot be tapped again.

### R-019 Buy and restore Pro
- Key: paperkeep.pro.unlock
- Type: new-capability
- Priority: must
- Statement: A single one-time purchase of $9.99 through the purchases block unlocks every Pro feature, and Restore brings it back on a new phone.
- Acceptance:
  - When the purchases block reports "purchased", every Pro feature unlocks and the paywall closes.
  - When it reports "cancelled", the paywall stays open, nothing unlocks and no error is shown.
  - When it reports "pending", the paywall shows "Purchase pending. Pro unlocks when the store confirms it." and nothing unlocks yet.
  - When it reports "failed", the paywall shows "Purchase failed. Try again." and nothing unlocks.
  - Restore Purchases, from the paywall or Settings, unlocks Pro when the purchases block reports an earlier purchase and shows "No purchase found" when it does not.
  - After an unlock, Pro stays unlocked when the phone is offline and the app restarts.

### R-020 Read text on every page
- Key: paperkeep.text.read
- Type: new-capability
- Priority: must
- Statement: Every saved page is read for text on the phone, in the background, whether or not the person has Pro.
- Acceptance:
  - Every saved page is sent to the text block once, with or without Pro, and the lines it returns are stored with the page.
  - While a document's pages are being read, its row shows "Reading text" and its other actions still work.
  - A page for which the text block returns no lines is stored as having no text and is not read again.
  - A page whose reading fails is read again on the next launch, at most 3 times in total.
  - After a Pro purchase, the text of documents saved earlier is shown without reading them again.
  - Adding pages to a document reads only the new pages.

### R-021 Text view
- Key: paperkeep.text.view
- Type: new-capability
- Priority: must
- Statement: With Pro, the person sees and copies the text of every page.
- Acceptance:
  - With Pro, the Text view shows each page's lines in reading order under "Page 1", "Page 2" and onward to the last page.
  - Copy on a page places that page's text on the clipboard and shows "Copied".
  - Copy All places every page's text on the clipboard, with a blank line between pages.
  - A page with no text shows "No text found on this page".
  - A page that is still being read shows "Reading text".
  - Without Pro, opening the Text view opens the paywall.

### R-022 Search
- Key: paperkeep.text.search
- Type: new-capability
- Priority: must
- Statement: The person finds documents by name and, with Pro, by any word on their pages.
- Acceptance:
  - With Pro, search lists documents whose name or page text contains every word typed, ignoring upper and lower case, so "invoice 4417" finds a document with "Invoice 4417 due March 3" on page 2.
  - A search with no matching document shows "No matches".
  - Accents are ignored, so "cafe" finds a document whose text contains "Café".
  - Each result found by page text shows its first matching page, for example "Match on page 2".
  - Without Pro, search matches document names only and shows "Unlock Pro to search inside documents" below the results.
  - Clearing the search box shows the whole library, and the search box is empty after a restart.

### R-023 Searchable PDFs
- Key: paperkeep.text.pdf
- Type: new-capability
- Priority: should
- Statement: With Pro, exported PDFs carry each page's text so other apps can search and copy it.
- Acceptance:
  - With Pro, an exported PDF carries each page's text through the pdf block, so reading its text returns "Invoice 4417 due March 3" for page 2.
  - Without Pro, exported PDFs carry no text layer.
  - A page with no recognized text adds no text to the PDF.

### R-024 Translate
- Key: paperkeep.text.translate
- Type: new-capability
- Priority: should
- Statement: With Pro, the person translates a document's text into another language on the phone and copies or shares the result.
- Acceptance:
  - When the text block returns "Factura 4417" for page 1 in Spanish, the Translation view shows that text under "Page 1".
  - The language list shows the languages the text block reports; the phone's own language is selected on first use, and the last choice is kept after a restart.
  - When a language must be downloaded first, the download prompt appears, and declining it translates nothing and shows "Language not downloaded".
  - A document with no recognized text shows "No text to translate".
  - Translating never changes the original pages or text, and Copy and Share act on the translated text.
  - Without Pro, Translate opens the paywall.

### R-025 Merge documents
- Key: paperkeep.pages.merge
- Type: new-capability
- Priority: should
- Statement: With Pro, the person combines several documents into a new one.
- Acceptance:
  - Merging a 2-page and a 3-page document creates a new 5-page document, pages in the order the documents were selected, and keeps both originals.
  - The merged document is named after the first selected document followed by " (merged)".
  - Recognized text moves with each page, so search finds the merged document by text from either original.
  - A merge that would pass 200 pages shows "A document can hold up to 200 pages" and creates nothing.
  - Without Pro, Merge opens the paywall.

### R-026 Extract and split pages
- Key: paperkeep.pages.split
- Type: new-capability
- Priority: should
- Statement: With Pro, the person copies chosen pages into a new document or splits a document in two.
- Acceptance:
  - Extracting pages 2 and 3 of a 5-page document creates a new 2-page document named after the original followed by " (pages 2-3)", and the original keeps 5 pages.
  - Splitting a 5-page document after page 2 creates documents of 2 and 3 pages named with " (part 1)" and " (part 2)", and keeps the original.
  - Split is not offered for a 1-page document, and Extract stays disabled until at least 1 page is chosen.
  - Recognized text moves with each page.
  - Without Pro, Extract and Split open the paywall.

### R-027 Edit a saved document's pages
- Key: paperkeep.pages.edit
- Type: new-capability
- Priority: should
- Statement: The person adds, removes, reorders and rotates pages in a document that is already saved.
- Acceptance:
  - Add Pages scans more pages and adds them to the end of the open document.
  - Deleting a page from a saved document opens an in-app confirmation, then removes that page and its text.
  - Delete Page is hidden for a 1-page document.
  - A new page order in a saved document is kept after a restart.
  - Rotating a saved page keeps its recognized text.
  - Editing pages is free and never opens the paywall.

### R-028 Sign
- Key: paperkeep.pages.sign
- Type: new-capability
- Priority: should
- Statement: With Pro, the person draws a signature once, saves it and places it on any page.
- Acceptance:
  - Save stays disabled until at least one stroke is drawn, and a saved signature is offered first the next time Sign is opened.
  - Up to 3 signatures can be saved; a fourth shows "You can save up to 3 signatures" and saves nothing, and deleting a saved signature opens an in-app confirmation.
  - Placing a signature on page 2 adds it to page 2 only, and the exported PDF shows it on page 2.
  - A placed signature can be moved and resized, and always stays inside the page's edges.
  - Removing a placed signature restores the page as it was before the signature was placed.
  - Without Pro, Sign opens the paywall.

### R-029 Automatic names and categories
- Key: paperkeep.library.autoname
- Type: new-capability
- Priority: should
- Statement: With Pro, each new document gets a suggested name and a category from its text, and the person can keep or change them.
- Acceptance:
  - With Pro and an AI model available, a new document's text goes to the AI block with instructions to return a title and one category, and the result names and files the document.
  - The categories are Receipt, Invoice, ID, Letter, Form, Business Card and Other; any other value, or a reply that cannot be read, becomes Other.
  - With no AI model, the name is the first line of text that has 3 to 60 characters, or "Scan" plus the date and time when there is none, and the category is Other.
  - A suggested title longer than 80 characters is cut to 80 characters.
  - A name the person typed is never replaced by a suggestion.
  - Without Pro, new documents keep the name "Scan" plus the date and time, and no category is shown.

### R-030 App Lock
- Key: paperkeep.privacy.lock
- Type: new-capability
- Priority: should
- Statement: With Pro, the person locks the app with Face ID, Touch ID, a fingerprint or the phone passcode.
- Acceptance:
  - App Lock is off on first use, and turning it on requires one successful authentication first.
  - With App Lock on, opening the app shows the lock screen until the lock block reports "success".
  - Returning after 60 or more seconds in the background shows the lock screen again, and returning after 59 seconds does not.
  - When the lock block reports "cancelled", the lock screen stays with an Unlock button, and when it reports "unavailable", the phone passcode is offered.
  - When the lock block emits "hide-content", the app covers every screen with the lock screen.
  - Without Pro, the App Lock switch opens the paywall.

### R-031 PDF passwords
- Key: paperkeep.privacy.password
- Type: new-capability
- Priority: should
- Statement: With Pro, the person protects an exported PDF with a password.
- Acceptance:
  - With Pro, Export offers "Protect with password".
  - A password of 4 to 64 characters, typed twice the same way, protects the PDF through the pdf block.
  - Two different entries show "Passwords don't match" and export nothing.
  - A password shorter than 4 or longer than 64 characters shows "Use 4 to 64 characters" and exports nothing.
  - The app never stores export passwords, and the next export starts with empty password fields.
  - Without Pro, "Protect with password" opens the paywall.

### R-032 Summarize a document
- Key: paperkeep.ai.summarize
- Type: new-capability
- Priority: should
- Statement: With Pro, on a phone with a model, the person gets a summary of a document made on the phone from its text.
- Acceptance:
  - With Pro and AI status "builtin" or "downloaded", Summarize sends the document's text to the AI block's summarize and shows the result labelled "Summary (AI, may contain mistakes)".
  - A document with no recognized text shows "No text to summarize".
  - While summarizing, the screen shows "Summarizing" and a Cancel button, and Cancel discards the result.
  - A failed summary shows "Could not summarize this document" and a Try Again button.
  - The summary can be copied and shared, and is not saved with the document.
  - With AI status "downloadable", Summarize offers the model download, and with status "unavailable" it is hidden.

### R-033 Ask about a document
- Key: paperkeep.ai.ask
- Type: new-capability
- Priority: should
- Statement: With Pro, on a phone with a model, the person asks a question about a document and gets an answer made on the phone.
- Acceptance:
  - Ask sends at most 2,000 words, taken from the pages that contain the most words of the question, and lists those page numbers under the answer.
  - An empty question, or one longer than 500 characters, shows "Ask a question of up to 500 characters" and sends nothing.
  - Each answer is labelled "Answer (AI, may contain mistakes)".
  - Tapping a listed page number opens the viewer at that page.
  - Questions and answers are not kept after the screen closes.
  - Without Pro, Ask opens the paywall, and with AI status "unavailable" Ask is hidden.

### R-034 AI model download
- Key: paperkeep.ai.model
- Type: new-capability
- Priority: should
- Statement: With Pro, on a phone that needs it, the person downloads the on-device AI model once and can remove it.
- Acceptance:
  - Settings shows the AI status as "Built in", "Downloaded", "Available to download" or "Not available on this phone".
  - Download is offered only with Pro and AI status "downloadable", shows the size the AI block reports, and starts only after a tap on Download.
  - Progress shows in whole percent, and a download larger than 200 MB on mobile data shows "Waiting for Wi-Fi" until Wi-Fi returns or the person allows mobile data.
  - A failed or cancelled download shows Try Again and leaves AI features off.
  - Remove Model, after an in-app confirmation, deletes the model and shows the space freed, for example "1.4 GB freed".

### R-035 Keep everything on the phone
- Key: paperkeep.storage.remember
- Type: new-capability
- Priority: must
- Statement: Documents, pages, folders, text, signatures and settings stay on the phone between launches, and nothing the person scans is sent anywhere unless they export, share or back it up.
- Acceptance:
  - After a restart, every document keeps its name, folder, category, page order, rotation, filters and recognized text.
  - After a restart, saved signatures and the settings for sort, page size, scan mode, compression, translation language, App Lock and last backup date are unchanged.
  - The app makes network calls only through the purchases block and the AI model download, and no call carries page images, names or recognized text.
  - Documents, pages and settings are stored only through the storage block.

### R-036 Storage space
- Key: paperkeep.storage.space
- Type: new-capability
- Priority: must
- Statement: The person sees how much space Paperkeep uses and is never left with a half-saved scan when the phone is full.
- Acceptance:
  - Settings shows the space used by documents in MB with one decimal place, or in GB with one decimal place from 1,024 MB up.
  - Saving, importing or merging when the phone would be left with less than 50 MB free shows "Not enough space to save" and keeps the pages in review.
  - Deleting documents updates the space used without a restart.
  - A downloaded AI model is shown on its own line as "AI model" with its size.

### R-037 Back up and restore
- Key: paperkeep.storage.backup
- Type: new-capability
- Priority: must
- Statement: The person saves the whole library as one backup file to a place they choose, such as Google Drive or iCloud Drive, and restores it on the same phone or a new one.
- Acceptance:
  - Back Up Now creates one file named "Paperkeep Backup" plus the date, holding every document, page, folder, category and recognized text, and opens the save dialog through the files block.
  - Restoring a backup of 5 documents into an empty library lists the same 5 documents with the same names, folders and page counts.
  - Restoring into a library that has documents adds the backup's documents, skips any document already present, and shows how many were added and how many were skipped.
  - A file that is not a Paperkeep backup shows "This file is not a Paperkeep backup" and changes nothing.
  - Cancelling the save or open dialog changes nothing and shows no error.
  - Backup and restore are free and never open the paywall.

### R-038 Backup reminder
- Key: paperkeep.storage.reminder
- Type: new-capability
- Priority: should
- Statement: The app reminds the person to back up when their library is at risk.
- Acceptance:
  - Settings shows the last backup date, or "Never" before the first backup.
  - When the last backup is more than 30 days old, the library shows a reminder with Back Up Now and Not Now.
  - When no backup exists and there are 10 or more documents, the library shows the same reminder.
  - Not Now hides the reminder for 7 days.
  - A successful backup hides the reminder and records the date.

### R-039 Settings
- Key: paperkeep.settings.main
- Type: new-capability
- Priority: must
- Statement: Settings gathers Pro status, restore, privacy, backup, storage, AI and support in one place.
- Acceptance:
  - Settings shows "Pro unlocked" when Pro is unlocked, and otherwise an Unlock Pro button that opens the paywall.
  - Settings lists Restore Purchases, App Lock, Back Up Now, Restore from Backup, Storage, AI, Default Page Size, Privacy Policy, Contact Support and the app version.
  - Contact Support opens an email to support@visudolabs.com with the app version in the subject.
  - Privacy Policy opens the privacy policy page in the phone's browser.
  - The app version shows as "Version" followed by the version and build number from the app's config, for example "Version 1.0.0 (12)".

## Rules and invariants
- Every service comes from the blocks in src/blocks: storage, files, purchases, camera, imaging, pdf, text, ai and lock. The app never calls a native library directly and never writes a second version of a block.
- Everything the person scans stays on the phone. No accounts, no ads, no analytics, no tracking and no crash-reporting service.
- Network calls go only through the purchases block and the AI model download. Page images, document names and recognized text are never sent.
- Scanning, saving, importing, editing pages, exporting at High, printing, folders, sharing and backup are free, unlimited and never watermarked.
- Pro is one non-consumable purchase tied to the RevenueCat entitlement "pro", and that entitlement unlocks every Pro feature.
- Every Pro feature is defined once in the Pro feature list; lock badges, the paywall and Settings all read that list.
- AI output is always labelled as AI and never changes the person's pages, names they typed, or recognized text.
- A document holds 1 to 200 pages. Any action that would pass 200 pages shows "A document can hold up to 200 pages".
- Two documents may share a name. Folder names are unique, ignoring upper and lower case and spaces at either end.
- Every destructive action uses an in-app confirmation, never a native alert.
- Backups hold documents, pages, folders, categories and recognized text. They never hold saved signatures, passwords or the purchase, which Restore Purchases brings back.
- Dates show in the form "Sep 28, 2026" and default names in the form "Scan 2026-09-28 14.05".

## What can't be undone
- Taking customer money: the $9.99 purchase is charged by Apple and Google, and refunds go through the stores.
- Deleting a document removes its pages from the phone for good, after an in-app confirmation. A backup is the only way back.
- Changing the price or removing a Pro feature after release, because buyers were promised what the paywall showed.
- Publishing to the App Store and Google Play.

## Dependencies
- The starter with its 9 blocks promoted (tag v3.2): storage, files, purchases, camera, imaging, pdf, text, ai and lock, each with a fake that tests can set.
- Two planned changes to the imaging block: rotate, and overlay for placing signatures.
- Apple Developer Program and Google Play Console accounts for Visudo Labs, enrolled in Apple's Small Business Program.
- A RevenueCat project with the entitlement "pro", one non-consumable product per store priced at $9.99, and the public iOS and Android SDK keys as EAS environment values.
- An EAS project with development builds, because the blocks' native modules do not run in Expo Go.
- MiniCPM-V 4.6 (Apache 2.0) in GGUF format for phones without a built-in model.
- A hosted privacy policy page and the support address support@visudolabs.com.
- The store name "Paperkeep: PDF Scanner & Tools" reserved in App Store Connect and Google Play Console.

## Out of scope
- Fax, cloud sync, accounts, subscriptions, ads, analytics and team sharing.
- A web release. The web build exists only so the build gate can export it.
- Importing existing PDF files, fill-in forms, redaction, table export to Word or Excel, and expense CSV export.
- Chatting across several documents at once, and any cloud AI.
- Text recognition for non-Latin scripts, tablet-specific layouts, widgets and watch apps.

## Not decided yet
- None.

## Assumptions
- M-01 · Target of 1,000 Pro purchases in the first 90 days (default, unconfirmed).
- M-02 · Target of 5 percent install-to-Pro conversion within 30 days of install (default, unconfirmed).
- M-03 · Target of 4.6 stars with at least 200 ratings per store within 120 days (default, unconfirmed).
- Platforms are iOS and Android only; there is no web release, and the web export exists only for the build gate (default, unconfirmed).
- R-017 · Buyers get Pro features added in later versions at no extra charge (default, unconfirmed).
- R-019 · The iOS purchase is shared with the buyer's family through Family Sharing (default, unconfirmed).
- R-020 · Text is read for every saved page with or without Pro, so earlier scans are searchable the moment Pro is bought (default, unconfirmed).
- R-020 · Text recognition covers Latin-script languages in version 1 (default, unconfirmed).
- R-028 · Up to 3 saved signatures (default, unconfirmed).
- R-030 · App Lock locks again after 60 seconds or more in the background (default, unconfirmed).
- R-034 · The downloaded model is offered only on phones with 6 GB of memory or more (default, unconfirmed).
- R-036 · Saving is refused when less than 50 MB would be left free (default, unconfirmed).
- R-038 · The backup reminder appears after 30 days, or with 10 or more documents and no backup, and Not Now hides it for 7 days (default, unconfirmed).
- R-039 · The support address is support@visudolabs.com (default, unconfirmed).

## Decisions
- 2026-09-28 · R-019 · Price is one non-consumable purchase of $9.99 on both stores, sold through RevenueCat. No subscription and no separate AI pack (owner).
- 2026-09-28 · R-035 · Everything stays on the phone and every free feature is unlimited (owner).
- 2026-09-28 · R-037 · Backup is manual, to one file the person saves through the save dialog, including Google Drive on Android. There is no automatic cloud backup of our own (owner).
- 2026-09-28 · R-032 · AI uses Apple's and Google's built-in on-device models where present, and MiniCPM-V 4.6 downloaded from the stores elsewhere (owner).
- 2026-09-29 · R-001 · The PRD is written as many small requirements so the tests cover every edge case before the first build (owner).
- 2026-09-29 · R-001 · Every service comes from the starter's blocks, and tests drive the app through each block's fake, set per test (chat).
- 2026-09-29 · R-002 · The imaging block gains rotate and overlay, the only planned changes to a block; overlay places signatures for R-028 (chat).
- 2026-09-29 · R-014 · PDFs are written by the pdf block's native writers, one page at a time, replacing the earlier pdf-lib choice (chat).
- 2026-09-29 · R-037 · A backup is the storage block's export archive, saved and opened through the files block (chat).
