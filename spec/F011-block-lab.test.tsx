import fs from 'fs';
import path from 'path';

// The contract these tests hold the Block Lab to:
// - app/block-lab.tsx is the Block Lab route; its default export is the screen.
// - The screen is on only when EXPO_PUBLIC_BLOCK_LAB is "1" (read through src/env.ts when the
//   screen's modules load). With any other value, or none, it shows the text "Not available" and
//   no block list.
// - src/lab/blocks.ts exports labBlocks: LabBlock[], one entry per folder in src/blocks:
//     type LabBlock = { name: string; deviceChecks: { name: string; run: () => Promise<unknown> }[] };
//   name is the folder name and deviceChecks follows the order of block.json's deviceChecks
//   (an entry there is a string or { name }). Loading the module or rendering the list starts no
//   check. A check passes when run() resolves and fails when it rejects or throws; the error text
//   is the error's message (or the thrown value when it is a string).
// - The screen lists the blocks in alphabetical order, whatever order labBlocks has. Each row has
//   testID "block-row-<name>", shows the block's name and each device check's name, and holds a
//   button whose accessibility label starts with "Run". A block with no device checks shows
//   "No device checks" in its row.
// - Check number i (from 0, in block.json order) of block <name> has testID "check-<name>-<i>";
//   it shows the check's name, then "Pass" or "Fail" once it has finished, and a Fail shows the
//   error text inside it too.
// - Run on a row runs that block's checks one at a time, in order: a check starts only after the
//   one before it has passed or failed.
// - The screen times each check with its own timer (setTimeout): a check still running 60 seconds
//   after it started shows Fail with "Timed out", and the next check starts at once.
// - A button whose accessibility label starts with "Run all", outside the rows, runs every block's
//   checks and then shows, in the element with testID "lab-totals", "<n> passed" and "<m> failed".

type LabCheck = { name: string; run: () => Promise<unknown> };
type LabBlock = { name: string; deviceChecks: LabCheck[] };
type BlockJson = { deviceChecks: (string | { name: string })[] };
type Rntl = typeof import('@testing-library/react-native');

const ROOT = path.resolve(__dirname, '..');
const REAL_BLOCKS = path.join(ROOT, 'src', 'blocks');
const TIMEOUT_MS = 60_000;

// Named mock… so jest.mock factories may use it. real: use src/lab/blocks.ts as written.
const mockLab = { real: false, blocks: [] as LabBlock[] };

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 11, right: 22, bottom: 33, left: 44 }),
}));

jest.mock('../src/lab/blocks', () => {
  if (mockLab.real) return jest.requireActual('../src/lab/blocks');
  return { __esModule: true, labBlocks: mockLab.blocks };
});

// A check whose run() stays pending until the test settles it.
function deferred(name: string) {
  let resolve: (v?: unknown) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const run = jest.fn(
    () =>
      new Promise<unknown>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  return { check: { name, run } as LabCheck, run, pass: () => resolve(), fail: (message: string) => reject(new Error(message)) };
}

function passing(name: string): LabCheck & { run: jest.Mock } {
  return { name, run: jest.fn(async () => undefined) };
}

function failing(name: string, message: string): LabCheck & { run: jest.Mock } {
  return {
    name,
    run: jest.fn(async () => {
      throw new Error(message);
    }),
  };
}

const previousLabValue = process.env.EXPO_PUBLIC_BLOCK_LAB;
afterEach(() => {
  jest.useRealTimers();
  if (previousLabValue === undefined) delete process.env.EXPO_PUBLIC_BLOCK_LAB;
  else process.env.EXPO_PUBLIC_BLOCK_LAB = previousLabValue;
});

// Loads the route fresh with EXPO_PUBLIC_BLOCK_LAB set to value (undefined: not set) and renders
// it. React and the testing library load in the same fresh registry as the screen.
function renderLab(value: string | undefined, blocks: LabBlock[] | 'real') {
  mockLab.real = blocks === 'real';
  mockLab.blocks = blocks === 'real' ? [] : blocks;
  if (value === undefined) delete process.env.EXPO_PUBLIC_BLOCK_LAB;
  else process.env.EXPO_PUBLIC_BLOCK_LAB = value;
  jest.resetModules();
  const React = require('react') as typeof import('react');
  const rntl = require('@testing-library/react-native') as Rntl;
  const Screen = require('../app/block-lab').default as React.ComponentType;
  const view = rntl.render(React.createElement(Screen));
  return { ...view, rntl };
}

function realBlockNames(): string[] {
  if (!fs.existsSync(REAL_BLOCKS)) return [];
  return fs
    .readdirSync(REAL_BLOCKS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

function checkNames(block: string): string[] {
  const json = JSON.parse(fs.readFileSync(path.join(REAL_BLOCKS, block, 'block.json'), 'utf8')) as BlockJson;
  return json.deviceChecks.map((c) => (typeof c === 'string' ? c : c.name));
}

function rowIds(view: ReturnType<typeof renderLab>): string[] {
  return view.queryAllByTestId(/^block-row-/).map((el) => el.props.testID as string);
}

function runButton(view: ReturnType<typeof renderLab>, block: string) {
  return view.rntl.within(view.getByTestId(`block-row-${block}`)).getByRole('button', { name: /^run\b/i });
}

function runAllButton(view: ReturnType<typeof renderLab>) {
  return view.getByRole('button', { name: /^run all\b/i });
}

function checkText(view: ReturnType<typeof renderLab>, block: string, index: number) {
  return view.rntl.within(view.getByTestId(`check-${block}-${index}`));
}

describe('F011 Block Lab screen', () => {
  it('With EXPO_PUBLIC_BLOCK_LAB set to "1" the Block Lab route shows the block list; with any other value it shows "Not available".', () => {
    const fixture = () => [
      { name: 'alpha', deviceChecks: [passing('opens')] },
      { name: 'beta', deviceChecks: [passing('saves')] },
    ];

    const on = renderLab('1', fixture());
    expect(rowIds(on)).toEqual(['block-row-alpha', 'block-row-beta']);
    expect(on.queryByText('Not available')).toBeNull();
    on.unmount();

    for (const value of [undefined, '', '0', 'true', 'yes', ' 1', '2']) {
      const off = renderLab(value, fixture());
      expect({ value, notAvailable: off.queryByText('Not available') !== null }).toEqual({ value, notAvailable: true });
      expect({ value, rows: rowIds(off) }).toEqual({ value, rows: [] });
      expect({ value, runAll: off.queryByRole('button', { name: /^run all\b/i }) }).toEqual({ value, runAll: null });
      off.unmount();
    }
  });

  it('The list has one row per folder in src/blocks, in alphabetical order, each showing the device checks named in its block.json.', () => {
    const folders = realBlockNames();
    expect(folders.length).toBeGreaterThan(0);

    const real = renderLab('1', 'real');
    expect(rowIds(real)).toEqual(folders.map((name) => `block-row-${name}`));
    for (const name of folders) {
      const row = real.rntl.within(real.getByTestId(`block-row-${name}`));
      expect(row.getAllByText(name).length).toBeGreaterThan(0);
      for (const check of checkNames(name)) {
        expect({ block: name, check, shown: row.queryAllByText(check).length > 0 }).toEqual({ block: name, check, shown: true });
      }
    }
    real.unmount();

    const unsorted = renderLab('1', [
      { name: 'zeta', deviceChecks: [passing('zeta opens')] },
      { name: 'alpha', deviceChecks: [passing('alpha opens'), passing('alpha saves')] },
      { name: 'mid', deviceChecks: [passing('mid opens')] },
    ]);
    expect(rowIds(unsorted)).toEqual(['block-row-alpha', 'block-row-mid', 'block-row-zeta']);
    const alpha = unsorted.rntl.within(unsorted.getByTestId('block-row-alpha'));
    expect(alpha.getByText('alpha opens')).toBeTruthy();
    expect(alpha.getByText('alpha saves')).toBeTruthy();
    expect(alpha.queryByText('zeta opens')).toBeNull();
    unsorted.unmount();
  });

  it("Run on a row runs that block's checks in order and shows Pass or Fail for each, with the error text for each Fail.", async () => {
    const first = deferred('opens');
    const second = deferred('reads');
    const third = failing('writes', 'Disk is read-only');
    const other = passing('other opens');
    const view = renderLab('1', [
      { name: 'alpha', deviceChecks: [first.check, second.check, third] },
      { name: 'beta', deviceChecks: [other] },
    ]);
    expect(first.run).not.toHaveBeenCalled();

    view.rntl.fireEvent.press(runButton(view, 'alpha'));
    await view.rntl.waitFor(() => expect(first.run).toHaveBeenCalledTimes(1));
    expect(second.run).not.toHaveBeenCalled();
    expect(third.run).not.toHaveBeenCalled();

    await view.rntl.act(async () => first.pass());
    await view.rntl.waitFor(() => expect(second.run).toHaveBeenCalledTimes(1));
    expect(checkText(view, 'alpha', 0).getByText('Pass')).toBeTruthy();
    expect(third.run).not.toHaveBeenCalled();

    await view.rntl.act(async () => second.fail('Camera permission denied'));
    await view.rntl.waitFor(() => expect(third.run).toHaveBeenCalledTimes(1));
    await view.rntl.waitFor(() => expect(checkText(view, 'alpha', 2).getByText('Fail')).toBeTruthy());

    expect(checkText(view, 'alpha', 0).queryByText('Fail')).toBeNull();
    expect(checkText(view, 'alpha', 1).getByText('Fail')).toBeTruthy();
    expect(checkText(view, 'alpha', 1).getByText(/Camera permission denied/)).toBeTruthy();
    expect(checkText(view, 'alpha', 1).queryByText('Pass')).toBeNull();
    expect(checkText(view, 'alpha', 2).getByText(/Disk is read-only/)).toBeTruthy();
    expect(checkText(view, 'alpha', 2).queryByText('Pass')).toBeNull();

    expect(other.run).not.toHaveBeenCalled();
    expect(checkText(view, 'beta', 0).queryByText('Pass')).toBeNull();
    expect(checkText(view, 'beta', 0).queryByText('Fail')).toBeNull();
    view.unmount();
  });

  it('A check still running after 60 seconds by the screen\'s timer shows Fail with "Timed out", and the next check starts.', async () => {
    jest.useFakeTimers();
    const hangs = deferred('waits forever');
    const next = deferred('runs next');
    const view = renderLab('1', [{ name: 'alpha', deviceChecks: [hangs.check, next.check] }]);

    view.rntl.fireEvent.press(runButton(view, 'alpha'));
    await view.rntl.act(async () => {
      await Promise.resolve();
    });
    expect(hangs.run).toHaveBeenCalledTimes(1);

    await view.rntl.act(async () => {
      jest.advanceTimersByTime(TIMEOUT_MS - 1_000);
    });
    expect(checkText(view, 'alpha', 0).queryByText('Fail')).toBeNull();
    expect(checkText(view, 'alpha', 0).queryByText(/Timed out/)).toBeNull();
    expect(next.run).not.toHaveBeenCalled();

    await view.rntl.act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    await view.rntl.act(async () => {
      await Promise.resolve();
    });
    expect(checkText(view, 'alpha', 0).getByText('Fail')).toBeTruthy();
    expect(checkText(view, 'alpha', 0).getByText(/Timed out/)).toBeTruthy();
    expect(next.run).toHaveBeenCalledTimes(1);

    // The timed-out check settling late changes nothing.
    await view.rntl.act(async () => hangs.pass());
    expect(checkText(view, 'alpha', 0).getByText('Fail')).toBeTruthy();
    expect(checkText(view, 'alpha', 0).queryByText('Pass')).toBeNull();

    await view.rntl.act(async () => next.pass());
    expect(checkText(view, 'alpha', 1).getByText('Pass')).toBeTruthy();
    view.unmount();
  });

  it("Run All runs every block's checks and shows the totals passed and failed.", async () => {
    const checks = {
      alpha: [passing('opens'), failing('reads', 'No file')],
      beta: [passing('saves'), passing('loads')],
      gamma: [failing('prints', 'No printer')],
      delta: [] as LabCheck[],
    };
    const view = renderLab(
      '1',
      Object.entries(checks).map(([name, deviceChecks]) => ({ name, deviceChecks })),
    );

    view.rntl.fireEvent.press(runAllButton(view));
    const totals = await view.rntl.waitFor(() => {
      const el = view.getByTestId('lab-totals');
      const text = view.rntl.within(el).queryAllByText(/./).map((t) => [t.props.children].flat().join('')).join(' ');
      expect(text).toMatch(/\b3 passed\b/i);
      expect(text).toMatch(/\b2 failed\b/i);
      return text;
    });
    expect(totals).toBeTruthy();

    for (const check of [...checks.alpha, ...checks.beta, ...checks.gamma]) expect(check.run as jest.Mock).toHaveBeenCalledTimes(1);
    expect(checkText(view, 'alpha', 0).getByText('Pass')).toBeTruthy();
    expect(checkText(view, 'alpha', 1).getByText('Fail')).toBeTruthy();
    expect(checkText(view, 'alpha', 1).getByText(/No file/)).toBeTruthy();
    expect(checkText(view, 'beta', 0).getByText('Pass')).toBeTruthy();
    expect(checkText(view, 'beta', 1).getByText('Pass')).toBeTruthy();
    expect(checkText(view, 'gamma', 0).getByText('Fail')).toBeTruthy();
    expect(checkText(view, 'gamma', 0).getByText(/No printer/)).toBeTruthy();
    view.unmount();
  });

  it('A block whose block.json lists no device checks shows "No device checks".', () => {
    const view = renderLab('1', [
      { name: 'alpha', deviceChecks: [passing('opens')] },
      { name: 'empty', deviceChecks: [] },
    ]);
    expect(view.rntl.within(view.getByTestId('block-row-empty')).getByText('No device checks')).toBeTruthy();
    expect(view.rntl.within(view.getByTestId('block-row-alpha')).queryByText('No device checks')).toBeNull();
    view.unmount();

    const real = renderLab('1', 'real');
    for (const name of realBlockNames()) {
      const empty = checkNames(name).length === 0;
      const shown = real.rntl.within(real.getByTestId(`block-row-${name}`)).queryByText('No device checks') !== null;
      expect({ block: name, shown }).toEqual({ block: name, shown: empty });
    }
    real.unmount();
  });
});
