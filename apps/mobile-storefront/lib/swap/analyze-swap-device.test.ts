import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { analyzeSwapDevice } from './analyze-swap-device';
import type { SwapMedia } from './select-swap-media';

// Isolate from global FormData.prototype.append mutations leaked by expo/winter across Jest workers.
class TestFormData {
  append(_name: string, _value: unknown, _filename?: string): void {}
}

let originalFormData: typeof FormData | undefined;
let appendSpy: ReturnType<typeof jest.spyOn> | undefined;

beforeAll(() => {
  originalFormData = globalThis.FormData;
  Object.defineProperty(globalThis, 'FormData', {
    configurable: true,
    writable: true,
    value: TestFormData,
  });
});

afterAll(() => {
  Object.defineProperty(globalThis, 'FormData', {
    configurable: true,
    writable: true,
    value: originalFormData,
  });
});

const mockBuildSwapStills = jest.fn<(media: SwapMedia) => Promise<string[]>>();
const mockFetchWithTimeout =
  jest.fn<
    (url: string, init: { method: string; body: FormData }) => Promise<unknown>
  >();

jest.mock('./build-swap-stills', () => ({
  buildSwapStills: (media: SwapMedia) => mockBuildSwapStills(media),
}));

jest.mock('@/lib/fetch-with-timeout', () => ({
  LONG_TIMEOUT: 60_000,
  fetchWithTimeout: (url: string, init: { method: string; body: FormData }) =>
    mockFetchWithTimeout(url, init),
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn() }),
}));

const photos: SwapMedia = {
  kind: 'photos',
  photos: [{ uri: 'file:///front.jpg', width: 4032, height: 3024 }],
};

const analysis = {
  model: 'iPhone 13',
  grade: 'Good',
  observations: ['Light scratches on the screen.'],
  basePrice: 385_000,
  estimatedValue: 231_000,
  deductionPercent: 40,
};

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe('analyzeSwapDevice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildSwapStills.mockResolvedValue([
      'file:///still-1.jpg',
      'file:///still-2.jpg',
    ]);
  });

  afterEach(() => {
    appendSpy?.mockRestore();
    appendSpy = undefined;
  });

  it('uploads the stills as frames and returns the offer', async () => {
    appendSpy = jest.spyOn(FormData.prototype, 'append');
    mockFetchWithTimeout.mockResolvedValue(
      jsonResponse(200, { success: true, data: analysis })
    );

    const outcome = await analyzeSwapDevice(photos);

    expect(outcome).toMatchObject({ ok: true, data: { model: 'iPhone 13' } });
    expect(mockBuildSwapStills).toHaveBeenCalledWith(photos);
    expect(appendSpy.mock.calls).toEqual([
      [
        'frames',
        { uri: 'file:///still-1.jpg', type: 'image/jpeg', name: 'frame-1.jpg' },
      ],
      [
        'frames',
        { uri: 'file:///still-2.jpg', type: 'image/jpeg', name: 'frame-2.jpg' },
      ],
    ]);
    const [url, init] = mockFetchWithTimeout.mock.calls[0] ?? [];
    expect(url).toMatch(/\/api\/ai\/grade-device$/);
    expect(init?.method).toBe('POST');
  });

  it('passes on the plain message from a refused check', async () => {
    mockFetchWithTimeout.mockResolvedValue(
      jsonResponse(400, { error: 'We could not identify this device.' })
    );

    expect(await analyzeSwapDevice(photos)).toEqual({
      ok: false,
      message: 'We could not identify this device.',
    });
  });

  it('falls back to the status when the error body is not JSON', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    });

    expect(await analyzeSwapDevice(photos)).toEqual({
      ok: false,
      message: 'Server error (HTTP 502)',
    });
  });

  it('reports unreadable media without calling the server', async () => {
    mockBuildSwapStills.mockRejectedValue(
      new Error(
        'We could not read one of your photos. Please try another photo.'
      )
    );

    expect(await analyzeSwapDevice(photos)).toEqual({
      ok: false,
      message:
        'We could not read one of your photos. Please try another photo.',
    });
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });

  it('reports a response that is not a valid analysis', async () => {
    mockFetchWithTimeout.mockResolvedValue(
      jsonResponse(200, { success: true })
    );

    expect(await analyzeSwapDevice(photos)).toEqual({
      ok: false,
      message: 'We could not process the AI analysis result. Please try again.',
    });
  });
});
