// The contract these tests hold the files block to:
// - src/blocks/files/index.ts (and index.web.ts) export:
//   - share(path): opens the share sheet with that file and resolves "shared" or "cancelled".
//   - print(path): opens the print dialog with that PDF and resolves "printed" or "cancelled".
//   - saveAs(path, name): opens the phone's save dialog with name suggested and resolves "saved"
//     or "cancelled".
//   - open(types, limit): types is a list of MIME types such as "application/pdf". Resolves
//     { files, skipped }: files the chosen files in the order chosen, each { path, name, type },
//     and skipped the number of chosen files left out. A chosen file whose type is not in types is
//     left out; of the rest, those beyond limit are left out. A cancelled pick is
//     { files: [], skipped: 0 }.
// - A path is a file:// URI (on web, a blob:, data: or http(s): URL). A file's type is its MIME type.
// - The phone's share sheet, print dialog and save dialog are reached through
//   requireOptionalNativeModule("FileExchange") from expo-modules-core. The module has
//   shareAsync(uri): Promise<boolean>, printAsync(uri): Promise<boolean> and
//   saveAsAsync(uri, name): Promise<boolean>, each of which shows the phone's own sheet or dialog
//   and resolves true when the person shared, printed or saved, and false when they dismissed it.
// - Files are chosen with expo-document-picker's getDocumentAsync, which resolves
//   { canceled, assets: [{ uri, name, mimeType?, size? }] } in the order chosen.
// - index.web.ts never uses FileExchange. share(path) and saveAs(path, name) download the file by
//   clicking an <a download> element whose href is path (or an object URL made from its contents),
//   and saveAs sets download to name; both resolve "shared" and "saved". print(path) loads the PDF
//   into an <iframe> (src path or an object URL made from it) or a window.open() window, and calls
//   print() on that frame's or window's contentWindow/window.

type Picked = { path: string; name: string; type: string };
type Opened = { files: Picked[]; skipped: number };
type FilesBlock = {
  share: (path: string) => Promise<'shared' | 'cancelled'>;
  print: (path: string) => Promise<'printed' | 'cancelled'>;
  saveAs: (path: string, name: string) => Promise<'saved' | 'cancelled'>;
  open: (types: string[], limit: number) => Promise<Opened>;
};
type Asset = { uri: string; name: string; mimeType?: string; size?: number };

// Named mock… so jest.mock factories may use them.
const mockPhone = {
  // What the person does with the next sheet or dialog: true completes it, false dismisses it.
  completes: true,
  picked: [] as Asset[],
  pickerCancelled: false,
};

const mockExchange = {
  shareAsync: jest.fn(async (_uri: string, _options?: unknown) => mockPhone.completes),
  printAsync: jest.fn(async (_uri: string, _options?: unknown) => mockPhone.completes),
  saveAsAsync: jest.fn(async (_uri: string, _name: string, _options?: unknown) => mockPhone.completes),
};

jest.mock('expo-modules-core', () => {
  let actual: Record<string, unknown> = {};
  try {
    actual = jest.requireActual('expo-modules-core');
  } catch {
    // Not installed; the block only needs requireOptionalNativeModule.
  }
  const original = actual.requireOptionalNativeModule as Function | undefined;
  return {
    ...actual,
    requireOptionalNativeModule: (moduleName: string) => {
      if (moduleName === 'FileExchange') return mockExchange;
      return original ? original(moduleName) : null;
    },
  };
});

const mockPicker = {
  getDocumentAsync: jest.fn(async (_options?: Record<string, unknown>) =>
    mockPhone.pickerCancelled
      ? { canceled: true, assets: null }
      : { canceled: false, assets: mockPhone.picked.map((a) => ({ ...a })) },
  ),
};

jest.mock('expo-document-picker', () => mockPicker, { virtual: true });

function load(entry: 'index' | 'index.web' = 'index'): FilesBlock {
  jest.resetModules();
  return require(`../src/blocks/files/${entry}`) as FilesBlock;
}

function phone(options: { completes?: boolean; picked?: Asset[]; pickerCancelled?: boolean }): void {
  mockPhone.completes = options.completes ?? true;
  mockPhone.picked = (options.picked ?? []).map((a) => ({ ...a }));
  mockPhone.pickerCancelled = options.pickerCancelled ?? false;
}

function exchangeCalls(): number {
  return (
    mockExchange.shareAsync.mock.calls.length +
    mockExchange.printAsync.mock.calls.length +
    mockExchange.saveAsAsync.mock.calls.length
  );
}

function shape(opened: Opened): Opened {
  return { files: opened.files.map((f) => ({ path: f.path, name: f.name, type: f.type })), skipped: opened.skipped };
}

function file(name: string, mimeType: string): Asset {
  return { uri: `file:///cache/DocumentPicker/${name}`, name, mimeType, size: 1024 };
}

function picked(asset: Asset): Picked {
  return { path: asset.uri, name: asset.name, type: asset.mimeType! };
}

const REPORT = 'file:///data/user/0/app/files/report.pdf';
const INVOICE = 'file:///data/user/0/app/files/invoice-0042.pdf';

// A small browser: enough of window and document to see downloads and print dialogs.
type FakeWindow = {
  print: jest.Mock;
  focus: jest.Mock;
  close: jest.Mock;
  addEventListener: (type: string, listener: (event?: unknown) => void) => void;
  removeEventListener: (type: string, listener: (event?: unknown) => void) => void;
  onload?: ((event?: unknown) => void) | null;
  onafterprint?: ((event?: unknown) => void) | null;
  fire: (type: string) => void;
  [key: string]: unknown;
};
type FakeElement = {
  tagName: string;
  href?: string;
  download?: string;
  src?: string;
  style: Record<string, unknown>;
  click: jest.Mock;
  contentWindow?: FakeWindow;
  onload?: ((event?: unknown) => void) | null;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => unknown;
  removeAttribute: (name: string) => void;
  addEventListener: (type: string, listener: (event?: unknown) => void) => void;
  removeEventListener: (type: string, listener: (event?: unknown) => void) => void;
  remove: jest.Mock;
  fire: (type: string) => void;
  [key: string]: unknown;
};

function fakeWindow(): FakeWindow {
  const listeners: Record<string, ((event?: unknown) => void)[]> = {};
  const win: FakeWindow = {
    print: jest.fn(() => {
      // The person closes the print dialog; anything waiting for afterprint hears it.
      setTimeout(() => win.fire('afterprint'), 0);
    }),
    focus: jest.fn(),
    close: jest.fn(),
    addEventListener: (type, listener) => {
      (listeners[type] ??= []).push(listener);
    },
    removeEventListener: (type, listener) => {
      listeners[type] = (listeners[type] ?? []).filter((l) => l !== listener);
    },
    fire: (type) => {
      const handler = win[`on${type}`];
      if (typeof handler === 'function') (handler as (event?: unknown) => void)({ type });
      for (const listener of [...(listeners[type] ?? [])]) listener({ type });
    },
  };
  return win;
}

function fakeElement(tagName: string): FakeElement {
  const listeners: Record<string, ((event?: unknown) => void)[]> = {};
  const element: FakeElement = {
    tagName: tagName.toUpperCase(),
    style: {},
    click: jest.fn(),
    setAttribute: (name, value) => {
      element[name] = value;
    },
    getAttribute: (name) => element[name] ?? null,
    removeAttribute: (name) => {
      delete element[name];
    },
    addEventListener: (type, listener) => {
      (listeners[type] ??= []).push(listener);
    },
    removeEventListener: (type, listener) => {
      listeners[type] = (listeners[type] ?? []).filter((l) => l !== listener);
    },
    remove: jest.fn(),
    fire: (type) => {
      const handler = element[`on${type}`];
      if (typeof handler === 'function') (handler as (event?: unknown) => void)({ type });
      for (const listener of [...(listeners[type] ?? [])]) listener({ type });
    },
  };
  if (element.tagName === 'IFRAME') element.contentWindow = fakeWindow();
  return element;
}

type Browser = {
  created: FakeElement[];
  opened: { url: string; win: FakeWindow }[];
  objectUrls: string[];
  window: FakeWindow;
};

const GLOBAL_KEYS = ['window', 'document', 'fetch'] as const;
let savedGlobals: Record<string, PropertyDescriptor | undefined> = {};
let savedUrl: { create?: unknown; revoke?: unknown } = {};

function installBrowser(): Browser {
  const browser: Browser = { created: [], opened: [], objectUrls: [], window: fakeWindow() };
  const body = {
    appendChild: jest.fn((child: FakeElement) => {
      // Frames load once they are in the page.
      if (child.tagName === 'IFRAME') setTimeout(() => child.fire('load'), 0);
      return child;
    }),
    removeChild: jest.fn((child: FakeElement) => child),
    append: jest.fn((...children: FakeElement[]) => {
      for (const child of children) body.appendChild(child);
    }),
  };
  const doc = {
    body,
    documentElement: body,
    head: body,
    createElement: jest.fn((tagName: string) => {
      const element = fakeElement(tagName);
      browser.created.push(element);
      return element;
    }),
  };
  Object.assign(browser.window, {
    document: doc,
    open: jest.fn((url: string) => {
      const win = fakeWindow();
      win.document = doc;
      browser.opened.push({ url, win });
      setTimeout(() => win.fire('load'), 0);
      return win;
    }),
    setTimeout,
    clearTimeout,
    location: { href: 'http://localhost:8081/' },
  });

  savedGlobals = {};
  for (const key of GLOBAL_KEYS) savedGlobals[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  const g = globalThis as Record<string, unknown>;
  g.window = browser.window;
  g.document = doc;
  g.fetch = jest.fn(async () => {
    const blob = new Blob(['%PDF-1.7\n'], { type: 'application/pdf' });
    return { ok: true, status: 200, blob: async () => blob, arrayBuffer: async () => blob.arrayBuffer() };
  });
  browser.window.fetch = g.fetch;

  savedUrl = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const urlStatics = URL as unknown as Record<string, unknown>;
  urlStatics.createObjectURL = jest.fn(() => {
    const made = `blob:http://localhost:8081/made-${browser.objectUrls.length + 1}`;
    browser.objectUrls.push(made);
    return made;
  });
  urlStatics.revokeObjectURL = jest.fn();
  browser.window.URL = URL;
  return browser;
}

function removeBrowser(): void {
  const g = globalThis as Record<string, unknown>;
  for (const key of GLOBAL_KEYS) {
    const descriptor = savedGlobals[key];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete g[key];
  }
  const urlStatics = URL as unknown as Record<string, unknown>;
  urlStatics.createObjectURL = savedUrl.create;
  urlStatics.revokeObjectURL = savedUrl.revoke;
}

// The href or src points at the file itself, or at an object URL the block made from it.
function pointsAt(browser: Browser, url: unknown, path: string): boolean {
  return url === path || (typeof url === 'string' && browser.objectUrls.includes(url));
}

function downloads(browser: Browser): FakeElement[] {
  return browser.created.filter((e) => e.tagName === 'A' && e.click.mock.calls.length > 0 && typeof e.download === 'string');
}

function printed(browser: Browser, path: string): boolean {
  const byFrame = browser.created.some(
    (e) => e.tagName === 'IFRAME' && e.contentWindow!.print.mock.calls.length > 0 && pointsAt(browser, e.src, path),
  );
  const byWindow = browser.opened.some((o) => o.win.print.mock.calls.length > 0 && pointsAt(browser, o.url, path));
  return byFrame || byWindow;
}

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_USE_FAKES;
  jest.clearAllMocks();
  phone({});
});

describe('F010 files block', () => {
  it('share(path) opens the share sheet with that file and resolves "shared" or "cancelled".', async () => {
    phone({ completes: true });
    const block = load();

    expect(await block.share(REPORT)).toBe('shared');
    expect(mockExchange.shareAsync).toHaveBeenCalledTimes(1);
    expect(mockExchange.shareAsync.mock.calls[0]![0]).toBe(REPORT);

    phone({ completes: false });
    expect(await block.share(INVOICE)).toBe('cancelled');
    expect(mockExchange.shareAsync).toHaveBeenCalledTimes(2);
    expect(mockExchange.shareAsync.mock.calls[1]![0]).toBe(INVOICE);

    // Sharing opens the share sheet, not the print or save dialog.
    expect(mockExchange.printAsync).not.toHaveBeenCalled();
    expect(mockExchange.saveAsAsync).not.toHaveBeenCalled();
  });

  it('print(path) opens the print dialog with that PDF and resolves "printed" or "cancelled".', async () => {
    phone({ completes: true });
    const block = load();

    expect(await block.print(REPORT)).toBe('printed');
    expect(mockExchange.printAsync).toHaveBeenCalledTimes(1);
    expect(mockExchange.printAsync.mock.calls[0]![0]).toBe(REPORT);

    phone({ completes: false });
    expect(await block.print(INVOICE)).toBe('cancelled');
    expect(mockExchange.printAsync).toHaveBeenCalledTimes(2);
    expect(mockExchange.printAsync.mock.calls[1]![0]).toBe(INVOICE);

    expect(mockExchange.shareAsync).not.toHaveBeenCalled();
    expect(mockExchange.saveAsAsync).not.toHaveBeenCalled();
  });

  it('saveAs(path, name) opens the phone\'s save dialog with that name suggested and resolves "saved" or "cancelled".', async () => {
    phone({ completes: true });
    const block = load();

    expect(await block.saveAs(REPORT, 'Quarterly report.pdf')).toBe('saved');
    expect(mockExchange.saveAsAsync).toHaveBeenCalledTimes(1);
    expect(mockExchange.saveAsAsync.mock.calls[0]!.slice(0, 2)).toEqual([REPORT, 'Quarterly report.pdf']);

    phone({ completes: false });
    expect(await block.saveAs(INVOICE, 'Invoice 42.pdf')).toBe('cancelled');
    expect(mockExchange.saveAsAsync).toHaveBeenCalledTimes(2);
    expect(mockExchange.saveAsAsync.mock.calls[1]!.slice(0, 2)).toEqual([INVOICE, 'Invoice 42.pdf']);

    expect(mockExchange.shareAsync).not.toHaveBeenCalled();
    expect(mockExchange.printAsync).not.toHaveBeenCalled();
  });

  it('open(types, limit) resolves the chosen files in the order chosen, each with its path, name and type, and resolves an empty list when cancelled.', async () => {
    const chosen = [
      file('zebra.pdf', 'application/pdf'),
      file('apple.pdf', 'application/pdf'),
      file('mango.pdf', 'application/pdf'),
    ];
    phone({ picked: chosen });
    const block = load();

    const result = shape(await block.open(['application/pdf'], 10));
    expect(result).toEqual({ files: chosen.map(picked), skipped: 0 });
    expect(mockPicker.getDocumentAsync).toHaveBeenCalledTimes(1);

    // Several types at once, still in the order chosen.
    const mixed = [file('scan.jpg', 'image/jpeg'), file('notes.txt', 'text/plain'), file('form.pdf', 'application/pdf')];
    phone({ picked: mixed });
    expect(shape(await block.open(['application/pdf', 'image/jpeg', 'text/plain'], 3))).toEqual({
      files: mixed.map(picked),
      skipped: 0,
    });

    phone({ pickerCancelled: true, picked: chosen });
    const cancelled = await block.open(['application/pdf'], 10);
    expect(cancelled.files).toEqual([]);
    expect(cancelled.skipped).toBe(0);

    // The next pick works as normal.
    phone({ picked: chosen.slice(0, 1) });
    expect(shape(await block.open(['application/pdf'], 10))).toEqual({ files: [picked(chosen[0]!)], skipped: 0 });
  });

  it('Files whose type is not in types, and files beyond limit, are left out and counted as skipped.', async () => {
    const pdfA = file('a.pdf', 'application/pdf');
    const notes = file('notes.txt', 'text/plain');
    const pdfB = file('b.pdf', 'application/pdf');
    const photo = file('photo.jpg', 'image/jpeg');
    const pdfC = file('c.pdf', 'application/pdf');
    const sheet = file('sheet.csv', 'text/csv');
    phone({ picked: [pdfA, notes, pdfB, photo, pdfC, sheet] });
    const block = load();

    // Wrong types only.
    expect(shape(await block.open(['application/pdf', 'image/jpeg', 'text/plain', 'text/csv'], 10))).toEqual({
      files: [pdfA, notes, pdfB, photo, pdfC, sheet].map(picked),
      skipped: 0,
    });
    expect(shape(await block.open(['application/pdf'], 10))).toEqual({ files: [pdfA, pdfB, pdfC].map(picked), skipped: 3 });

    // Beyond limit only.
    expect(shape(await block.open(['application/pdf', 'image/jpeg', 'text/plain', 'text/csv'], 4))).toEqual({
      files: [pdfA, notes, pdfB, photo].map(picked),
      skipped: 2,
    });

    // Both: wrong types are left out first, then files beyond limit.
    expect(shape(await block.open(['application/pdf', 'image/jpeg'], 3))).toEqual({
      files: [pdfA, pdfB, photo].map(picked),
      skipped: 3,
    });
    expect(shape(await block.open(['application/pdf'], 1))).toEqual({ files: [pdfA].map(picked), skipped: 5 });

    // No chosen file has an allowed type.
    expect(shape(await block.open(['image/png'], 5))).toEqual({ files: [], skipped: 6 });
  });

  it('On web, share and saveAs download the file and print opens the browser\'s print dialog.', async () => {
    const WEB_REPORT = 'blob:http://localhost:8081/4b1d-report';
    const WEB_INVOICE = 'blob:http://localhost:8081/9e2c-invoice';
    const browser = installBrowser();
    try {
      phone({ completes: false });
      const web = load('index.web');

      // share downloads the file.
      expect(await web.share(WEB_REPORT)).toBe('shared');
      const shared = downloads(browser);
      expect(shared).toHaveLength(1);
      expect(pointsAt(browser, shared[0]!.href, WEB_REPORT)).toBe(true);

      // saveAs downloads the file under the name given.
      expect(await web.saveAs(WEB_INVOICE, 'Invoice 42.pdf')).toBe('saved');
      const saved = downloads(browser).filter((a) => !shared.includes(a));
      expect(saved).toHaveLength(1);
      expect(pointsAt(browser, saved[0]!.href, WEB_INVOICE)).toBe(true);
      expect(saved[0]!.download).toBe('Invoice 42.pdf');

      // print opens the browser's print dialog with that PDF.
      const outcome = await web.print(WEB_REPORT);
      expect(['printed', 'cancelled']).toContain(outcome);
      expect(printed(browser, WEB_REPORT)).toBe(true);
      // Not a download, and not the app's own page.
      expect(downloads(browser)).toHaveLength(2);
      expect(browser.window.print).not.toHaveBeenCalled();

      // The phone's sheets and dialogs are never used on web.
      expect(exchangeCalls()).toBe(0);
    } finally {
      removeBrowser();
    }
  });
});
