# PRD — Tip Split
- Product: tip-split
- Owner: Adam Fisher
- Version: 0.2
- Status: ready
- Platforms: ios, android, web
- Funding: self-funded

## Objective
Let anyone at a restaurant table work out the tip and each person's share in a few seconds, so that Tip Split becomes the calculator they reopen every time they eat out.

## Users and journeys
A diner paying at a table, usually one-handed and in a hurry. Today they open the phone calculator, do the tip in their head, and argue about the split. With Tip Split they type the bill, tap a tip, set the number of people, and read out one number. Regular users want last time's tip percent remembered, and want to look back at what a past meal cost.

## Outcome metrics
### M-01 Repeat use
- Baseline: 0
- Target: 40 percent of people who open the app in week one open it again in week two
- Timeframe: 30 days after release
- Measured by: event app.opened, grouped by install week

### M-02 Saved bills
- Baseline: 0
- Target: 2 saved bills per active user per month
- Timeframe: 30 days after release
- Measured by: event history.saved

## Requirements
### R-001 Tip
- Key: tipsplit.calculator.tip
- Type: new-capability
- Priority: must
- Statement: The person enters a bill amount, picks a tip percent, and sees the tip and the total update as they type.
- Acceptance:
  - Tip choices are 15, 18, 20 and 25 percent, plus a custom percent from 0 to 100.
  - A bill of 50.00 at 20 percent shows a tip of 10.00 and a total of 60.00.
  - A bill of 33.33 at 18 percent shows a tip of 6.00 and a total of 39.33, because the tip is rounded to the nearest cent.
  - A custom percent above 100 or below 0 is rejected with an inline message and the previous percent is kept.

### R-002 Split
- Key: tipsplit.calculator.split
- Type: new-capability
- Priority: must
- Statement: The person sets how many people are paying and sees each person's share.
- Acceptance:
  - A stepper sets the number of people from 1 to 20 and cannot go outside that range.
  - Each share is rounded up to the next cent, so the table never underpays.
  - A total of 100.00 split between 3 people shows 33.34 each and 0.02 extra.
  - With 1 person the share equals the total and no extra is shown.

### R-003 Round up
- Key: tipsplit.calculator.round-up
- Type: new-capability
- Priority: should
- Statement: A switch rounds the total up to the next whole dollar and shows what tip percent that works out to.
- Acceptance:
  - With the switch on, a total of 58.40 becomes 59.00.
  - The effective tip percent is shown to one decimal place, for example 21.2 percent.
  - A total that is already a whole dollar does not change.

### R-004 Bad input
- Key: tipsplit.calculator.validation
- Type: new-capability
- Priority: must
- Statement: Invalid bill amounts never crash the app and never show a result.
- Acceptance:
  - An empty, negative or non-numeric bill shows a short message under the field and no tip, total or share.
  - A bill above 1,000,000 shows a message that the amount is too large.
  - Correcting the input removes the message and shows the result again.

### R-005 Remember
- Key: tipsplit.preferences.remember
- Type: new-capability
- Priority: should
- Statement: The app remembers the last tip percent and the last number of people.
- Acceptance:
  - After the app is closed and reopened, the last tip percent and number of people are selected.
  - The values are stored on the device only.

### R-006 History
- Key: tipsplit.history.save
- Type: new-capability
- Priority: should
- Statement: The person can save a bill and look back at past bills.
- Acceptance:
  - Save stores the bill, tip percent, total, number of people and the date.
  - The History screen lists saved bills newest first and keeps at most 20, dropping the oldest.
  - Deleting a saved bill asks for confirmation first.
  - Saved bills are still there after the app is closed and reopened.
  - The History screen shows 20 saved bills without a loading indicator.

## Rules and invariants
- Money is held as whole cents (integers) everywhere in the code. No floating-point arithmetic on money.
- All calculation lives in plain TypeScript functions with no React in them, so it can be tested without rendering.
- Everything stays on the device. No accounts, no network calls.
- US dollars, two decimal places.

## What can't be undone
- Publishing to the App Store, Google Play and the public web address.

## Dependencies
- Apple Developer and Google Play organization accounts (exist).
- An EAS project for cloud builds and web hosting.

## Out of scope
- Tax, currency conversion, sharing a bill, uneven splits, ads and purchases.

## Not decided yet
- None.

## Assumptions
- A saved bill has no note field in this version (default, unconfirmed).

## Decisions
- 2026-09-21 · R-001 · First-launch tip percent is 18 (owner).
- 2026-09-21 · R-006 · "loads fast" replaced with a testable criterion (owner).
