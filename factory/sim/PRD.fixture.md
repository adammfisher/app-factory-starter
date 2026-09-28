# PRD — Example
- Product: example
- Owner: Factory selftest
- Version: 0.2
- Status: ready
- Platforms: ios, android, web
- Funding: self-funded

## Objective
A lint fixture for the factory selftest. It is interview-complete and must produce no refusals. It is not an app to build.

## Users and journeys
A person keeps a running count of something and wants the count to survive closing the app.

## Outcome metrics
### M-01 Repeat use
- Baseline: 0
- Target: 40 percent of people who open the app in week one open it again in week two
- Timeframe: 30 days after release
- Measured by: event app.opened, grouped by install week

## Requirements
### R-001 Count
- Key: example.counter.count
- Type: new-capability
- Priority: must
- Statement: The person taps a button to add one to a count and sees the new count at once.
- Acceptance:
  - The count starts at 0.
  - Tapping Add three times shows 3.
  - The count stops at 9,999 and shows a message that the limit is reached.

### R-002 Step
- Key: example.counter.step
- Type: new-capability
- Priority: must
- Statement: The person sets a step size and each tap adds that step.
- Acceptance:
  - A stepper sets the step from 1 to 10 and cannot go outside that range.
  - With a step of 5, two taps show 10.
  - With a step of 1 the count grows by one per tap.

### R-003 History
- Key: example.history.save
- Type: new-capability
- Priority: should
- Statement: The count is kept on the device and is still there after the app is reopened.
- Acceptance:
  - After the app is closed and reopened, the last count is shown.
  - The value is stored on the device only.

## Rules and invariants
- All logic lives in plain TypeScript functions with no React in them.
- Everything stays on the device. No accounts, no network calls.

## What can't be undone
- Publishing to the App Store, Google Play and the public web address.

## Dependencies
- None.

## Out of scope
- Accounts, sync, ads and purchases.

## Not decided yet
- None.

## Assumptions
- None.

## Decisions
- 2026-09-21 · R-001 · The count starts at 0 (owner).
