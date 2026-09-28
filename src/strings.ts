// All user-facing copy lives here, never inline in JSX.
export const strings = {
  title: 'My App',
  subtitle: 'Built by the app factory.',
  lock: {
    prompt: 'Unlock to continue',
    cancel: 'Cancel',
  },
  lab: {
    title: 'Block Lab',
    notAvailable: 'Not available',
    run: 'Run',
    runLabel: (block: string) => `Run ${block} checks`,
    runAll: 'Run all',
    runAllLabel: 'Run all device checks',
    noDeviceChecks: 'No device checks',
    running: 'Running',
    pass: 'Pass',
    fail: 'Fail',
    timedOut: 'Timed out',
    passed: (count: number) => `${count} passed`,
    failed: (count: number) => `${count} failed`,
  },
} as const;
