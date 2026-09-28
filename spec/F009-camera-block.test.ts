// The contract these tests hold the camera block to:
// - src/blocks/camera/index.ts (and index.web.ts) export:
//   - scanDocument(): resolves the pages as images in capture order, or { error: "<code>" }.
//     A cancelled scan resolves []. Camera permission denied is { error: "camera-denied" }.
//   - openSettings(): opens the app's page in the phone's settings, through Linking.openSettings()
//     from react-native or openSettings() from expo-linking.
//   - importPhotos(limit): resolves { images, dropped }: images in the order chosen, at most limit
//     of them, and dropped the number of chosen images left out.
// - An image is { path, width, height }: path is a file:// URI (on web, a blob: or data: URL),
//   width and height in pixels.
// - The phone's document camera (VisionKit on iOS, ML Kit's document scanner on Android) is reached
//   through requireOptionalNativeModule("DocumentScanner") from expo-modules-core. The module has
//   requestPermissionAsync(): Promise<boolean>, true when the camera is allowed, and
//   scanAsync(): Promise<{ uri, width, height }[]>, pages in capture order, which rejects with an
//   error whose code is "ERR_CANCELLED" when the person cancels and "ERR_CAMERA_DENIED" when the
//   camera is not allowed.
// - Photos are chosen with expo-image-picker's launchImageLibraryAsync, which resolves
//   { canceled, assets: [{ uri, width, height, mimeType?, fileName? }] } in the order chosen. On web
//   the same call opens the browser's file picker.
// - An asset is HEIC when its mimeType is image/heic or image/heif, or its uri or fileName ends in
//   .heic or .heif, in any case. HEIC images are converted with expo-image-manipulator, either
//   manipulateAsync(uri, [], { format: SaveFormat.JPEG }) or
//   ImageManipulator.manipulate(uri).renderAsync() then saveAsync({ format: SaveFormat.JPEG }),
//   and the converted file is what is returned.
// - index.web.ts resolves { error: "not-available" } for scanDocument without asking anything.

type Image = { path: string; width: number; height: number };
type Failure = { error: string };
type Imported = { images: Image[]; dropped: number };
type CameraBlock = {
  scanDocument: () => Promise<Image[] | Failure>;
  openSettings: () => Promise<void> | void;
  importPhotos: (limit: number) => Promise<Imported | Failure>;
};
type NativePage = { uri: string; width: number; height: number };
type Asset = { uri: string; width: number; height: number; mimeType?: string; fileName?: string };
type Saved = { uri: string; width: number; height: number };

// Named mock… so jest.mock factories may use them.
const mockPhone = {
  cameraAllowed: true,
  scan: { kind: 'pages', pages: [] as NativePage[] } as { kind: 'pages'; pages: NativePage[] } | { kind: 'cancel' },
  picked: [] as Asset[],
  pickerCancelled: false,
  converted: 0,
  conversions: [] as { from: string; format: unknown; to: string }[],
};

function mockNativeError(code: string): Error {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}

const mockScanner = {
  requestPermissionAsync: jest.fn(async () => mockPhone.cameraAllowed),
  scanAsync: jest.fn(async (): Promise<NativePage[]> => {
    if (!mockPhone.cameraAllowed) throw mockNativeError('ERR_CAMERA_DENIED');
    if (mockPhone.scan.kind === 'cancel') throw mockNativeError('ERR_CANCELLED');
    return mockPhone.scan.pages.map((p) => ({ ...p }));
  }),
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
      if (moduleName === 'DocumentScanner') return mockScanner;
      return original ? original(moduleName) : null;
    },
  };
});

const mockPicker = {
  launchImageLibraryAsync: jest.fn(async (_options?: Record<string, unknown>) =>
    mockPhone.pickerCancelled
      ? { canceled: true, assets: null }
      : { canceled: false, assets: mockPhone.picked.map((a) => ({ ...a, type: 'image' })) },
  ),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
  getMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
};

jest.mock(
  'expo-image-picker',
  () => ({
    ...mockPicker,
    MediaTypeOptions: { All: 'All', Images: 'Images', Videos: 'Videos' },
    UIImagePickerPreferredAssetRepresentationMode: { Automatic: 'automatic', Compatible: 'compatible', Current: 'current' },
  }),
  { virtual: true },
);

// The converter writes a new JPEG named after the conversion, keeping the image's size.
function mockConvert(from: string, format: unknown, size: { width: number; height: number }): Saved {
  const to = `file:///cache/ImageManipulator/converted-${++mockPhone.converted}.jpg`;
  mockPhone.conversions.push({ from, format, to });
  return { uri: to, width: size.width, height: size.height };
}

function mockSizeOf(uri: string): { width: number; height: number } {
  const asset = mockPhone.picked.find((a) => a.uri === uri);
  if (asset) return { width: asset.width, height: asset.height };
  const page = mockPhone.scan.kind === 'pages' ? mockPhone.scan.pages.find((p) => p.uri === uri) : undefined;
  return page ? { width: page.width, height: page.height } : { width: 1, height: 1 };
}

const mockManipulator = {
  manipulateAsync: jest.fn(async (uri: string, _actions: unknown[] = [], options: { format?: unknown } = {}) =>
    mockConvert(uri, options.format ?? 'jpeg', mockSizeOf(uri)),
  ),
  manipulate: jest.fn((uri: string) => {
    const context = {
      resize: () => context,
      rotate: () => context,
      flip: () => context,
      crop: () => context,
      extent: () => context,
      reset: () => context,
      renderAsync: async () => ({
        width: mockSizeOf(uri).width,
        height: mockSizeOf(uri).height,
        saveAsync: async (options: { format?: unknown } = {}) => mockConvert(uri, options.format ?? 'jpeg', mockSizeOf(uri)),
      }),
    };
    return context;
  }),
};

jest.mock(
  'expo-image-manipulator',
  () => ({
    manipulateAsync: mockManipulator.manipulateAsync,
    ImageManipulator: { manipulate: mockManipulator.manipulate },
    SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
    FlipType: { Vertical: 'vertical', Horizontal: 'horizontal' },
  }),
  { virtual: true },
);

const mockOpenSettings = jest.fn(async () => undefined);

jest.mock('expo-linking', () => {
  let actual: Record<string, unknown> = {};
  try {
    actual = jest.requireActual('expo-linking');
  } catch {
    // Not installed; the block may use react-native's Linking instead.
  }
  return { ...actual, openSettings: mockOpenSettings };
});

function load(entry: 'index' | 'index.web' = 'index'): CameraBlock {
  jest.resetModules();
  const block = require(`../src/blocks/camera/${entry}`) as CameraBlock;
  // react-native's Linking, from the same module registry the block was loaded into.
  const { Linking } = require('react-native') as { Linking: Record<string, unknown> };
  Linking.openSettings = mockOpenSettings;
  return block;
}

function isFailure(value: unknown): value is Failure {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as Failure).error === 'string';
}

function expectPages(value: Image[] | Failure): Image[] {
  if (isFailure(value)) throw new Error(`expected pages, got the error "${value.error}"`);
  expect(Array.isArray(value)).toBe(true);
  return value;
}

function expectImported(value: Imported | Failure): Imported {
  if (isFailure(value)) throw new Error(`expected imported photos, got the error "${value.error}"`);
  return value;
}

function shape(images: Image[]): Image[] {
  return images.map((i) => ({ path: i.path, width: i.width, height: i.height }));
}

function scannerCalls(): number {
  return mockScanner.requestPermissionAsync.mock.calls.length + mockScanner.scanAsync.mock.calls.length;
}

function phone(options: {
  cameraAllowed?: boolean;
  pages?: NativePage[];
  cancel?: boolean;
  picked?: Asset[];
  pickerCancelled?: boolean;
}): void {
  mockPhone.cameraAllowed = options.cameraAllowed ?? true;
  mockPhone.scan = options.cancel ? { kind: 'cancel' } : { kind: 'pages', pages: (options.pages ?? []).map((p) => ({ ...p })) };
  mockPhone.picked = (options.picked ?? []).map((a) => ({ ...a }));
  mockPhone.pickerCancelled = options.pickerCancelled ?? false;
  mockPhone.conversions = [];
}

const PAGES: NativePage[] = [
  { uri: 'file:///cache/DocumentScanner/scan-a/page-1.jpg', width: 1240, height: 1754 },
  { uri: 'file:///cache/DocumentScanner/scan-a/page-2.jpg', width: 1754, height: 1240 },
  { uri: 'file:///cache/DocumentScanner/scan-a/page-3.jpg', width: 1200, height: 1600 },
];

function jpeg(name: string, width: number, height: number): Asset {
  return { uri: `file:///cache/ImagePicker/${name}.jpg`, width, height, mimeType: 'image/jpeg', fileName: `${name}.jpg` };
}

beforeEach(() => {
  delete process.env.EXPO_PUBLIC_USE_FAKES;
  jest.clearAllMocks();
  phone({});
});

describe('F009 camera block', () => {
  it('scanDocument() resolves the captured pages in capture order, each with its file path, width and height.', async () => {
    phone({ pages: PAGES });
    const block = load();

    const pages = expectPages(await block.scanDocument());
    expect(shape(pages)).toEqual(PAGES.map((p) => ({ path: p.uri, width: p.width, height: p.height })));
    expect(mockScanner.scanAsync).toHaveBeenCalledTimes(1);

    // A second scan returns its own pages, still in capture order.
    const second: NativePage[] = [
      { uri: 'file:///cache/DocumentScanner/scan-b/page-1.jpg', width: 900, height: 1300 },
      { uri: 'file:///cache/DocumentScanner/scan-b/page-2.jpg', width: 901, height: 1301 },
    ];
    phone({ pages: second });
    const again = expectPages(await block.scanDocument());
    expect(shape(again)).toEqual(second.map((p) => ({ path: p.uri, width: p.width, height: p.height })));
  });

  it('A cancelled scan resolves an empty list and no error.', async () => {
    phone({ cancel: true });
    const block = load();

    let result: Image[] | Failure | undefined;
    await expect(
      (async () => {
        result = await block.scanDocument();
      })(),
    ).resolves.toBeUndefined();
    expect(result).toEqual([]);
    expect(mockScanner.scanAsync).toHaveBeenCalledTimes(1);

    // The next scan works as normal.
    phone({ pages: PAGES.slice(0, 1) });
    expect(shape(expectPages(await block.scanDocument()))).toEqual([{ path: PAGES[0]!.uri, width: PAGES[0]!.width, height: PAGES[0]!.height }]);
  });

  it('When camera permission is denied, scanDocument() resolves the error "camera-denied", and openSettings() opens the app\'s page in the phone\'s settings.', async () => {
    phone({ cameraAllowed: false, pages: PAGES });
    const block = load();

    expect(await block.scanDocument()).toEqual({ error: 'camera-denied' });
    expect(mockOpenSettings).not.toHaveBeenCalled();

    await block.openSettings();
    expect(mockOpenSettings).toHaveBeenCalledTimes(1);

    // Once the camera is allowed again, the same block scans.
    phone({ cameraAllowed: true, pages: PAGES });
    expect(shape(expectPages(await block.scanDocument()))).toEqual(
      PAGES.map((p) => ({ path: p.uri, width: p.width, height: p.height })),
    );
  });

  it('importPhotos(limit) resolves the chosen images in the order chosen, keeps at most limit of them, and reports how many were dropped.', async () => {
    const chosen = [jpeg('e', 400, 300), jpeg('a', 300, 400), jpeg('d', 640, 480), jpeg('b', 480, 640), jpeg('c', 800, 600)];
    const expected = chosen.map((a) => ({ path: a.uri, width: a.width, height: a.height }));

    phone({ picked: chosen });
    const block = load();

    const limited = expectImported(await block.importPhotos(3));
    expect(shape(limited.images)).toEqual(expected.slice(0, 3));
    expect(limited.dropped).toBe(2);
    expect(mockPicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);

    const exact = expectImported(await block.importPhotos(5));
    expect(shape(exact.images)).toEqual(expected);
    expect(exact.dropped).toBe(0);

    const roomy = expectImported(await block.importPhotos(10));
    expect(shape(roomy.images)).toEqual(expected);
    expect(roomy.dropped).toBe(0);

    const one = expectImported(await block.importPhotos(1));
    expect(shape(one.images)).toEqual(expected.slice(0, 1));
    expect(one.dropped).toBe(4);
  });

  it('HEIC images are converted to JPEG before they are returned.', async () => {
    const heicByMime: Asset = { uri: 'file:///cache/ImagePicker/IMG_0001', width: 4032, height: 3024, mimeType: 'image/heic' };
    const plain = jpeg('plain', 1200, 900);
    const heicByName: Asset = { uri: 'file:///cache/ImagePicker/IMG_0002.HEIC', width: 3024, height: 4032, fileName: 'IMG_0002.HEIC' };
    const heif: Asset = { uri: 'file:///cache/ImagePicker/IMG_0003.heif', width: 2000, height: 1500, mimeType: 'image/heif' };
    phone({ picked: [heicByMime, plain, heicByName, heif] });
    const block = load();

    const result = expectImported(await block.importPhotos(10));
    expect(result.dropped).toBe(0);
    expect(result.images).toHaveLength(4);

    const convertedFrom = (asset: Asset) => mockPhone.conversions.filter((c) => c.from === asset.uri);
    for (const [index, asset] of [
      [0, heicByMime],
      [2, heicByName],
      [3, heif],
    ] as [number, Asset][]) {
      const conversions = convertedFrom(asset);
      expect({ asset: asset.uri, conversions: conversions.length }).toEqual({ asset: asset.uri, conversions: 1 });
      expect({ asset: asset.uri, format: conversions[0]!.format }).toEqual({ asset: asset.uri, format: 'jpeg' });
      const image = result.images[index]!;
      expect({ asset: asset.uri, path: image.path }).toEqual({ asset: asset.uri, path: conversions[0]!.to });
      expect(image.path).toMatch(/\.jpe?g$/i);
      expect({ width: image.width, height: image.height }).toEqual({ width: asset.width, height: asset.height });
    }

    // Every returned image is a JPEG, and none is still HEIC.
    for (const image of result.images) {
      expect(image.path).not.toMatch(/\.hei[cf]$/i);
    }
    expect(result.images[1]!.path).toMatch(/\.jpe?g$/i);
    expect({ width: result.images[1]!.width, height: result.images[1]!.height }).toEqual({ width: 1200, height: 900 });

    // A HEIC page from the document camera is converted too.
    mockPhone.conversions = [];
    const heicPage: NativePage = { uri: 'file:///cache/DocumentScanner/scan-c/page-1.heic', width: 1500, height: 2000 };
    phone({ pages: [heicPage, PAGES[0]!] });
    const pages = expectPages(await block.scanDocument());
    expect(pages).toHaveLength(2);
    const pageConversions = mockPhone.conversions.filter((c) => c.from === heicPage.uri);
    expect(pageConversions).toHaveLength(1);
    expect(pageConversions[0]!.format).toBe('jpeg');
    expect(shape(pages)).toEqual([
      { path: pageConversions[0]!.to, width: 1500, height: 2000 },
      { path: PAGES[0]!.uri, width: PAGES[0]!.width, height: PAGES[0]!.height },
    ]);
  });

  it('On web, scanDocument() resolves the error "not-available", and importPhotos uses the browser\'s file picker.', async () => {
    const chosen: Asset[] = [
      { uri: 'blob:http://localhost:8081/7f1c', width: 640, height: 480, mimeType: 'image/jpeg', fileName: 'receipt.jpg' },
      { uri: 'blob:http://localhost:8081/2a9e', width: 480, height: 640, mimeType: 'image/png', fileName: 'note.png' },
      { uri: 'blob:http://localhost:8081/c03b', width: 800, height: 600, mimeType: 'image/jpeg', fileName: 'page.jpg' },
    ];
    phone({ pages: PAGES, picked: chosen });
    const web = load('index.web');

    expect(await web.scanDocument()).toEqual({ error: 'not-available' });
    expect(scannerCalls()).toBe(0);

    const result = expectImported(await web.importPhotos(2));
    expect(mockPicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
    expect(shape(result.images)).toEqual(chosen.slice(0, 2).map((a) => ({ path: a.uri, width: a.width, height: a.height })));
    expect(result.dropped).toBe(1);
    expect(scannerCalls()).toBe(0);
  });
});
