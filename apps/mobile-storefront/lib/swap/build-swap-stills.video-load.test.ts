import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { buildSwapStills, UNREADABLE_VIDEO_MESSAGE } from './build-swap-stills';

let mockPlayerStatus: 'idle' | 'loading' | 'readyToPlay' | 'error' = 'loading';
let statusChangeListener:
  | ((payload: { status: typeof mockPlayerStatus }) => void)
  | undefined;
const mockSubscriptionRemove = jest.fn();
const mockPlayerRelease = jest.fn();
const mockGenerateThumbnailsAsync = jest.fn<() => Promise<unknown[]>>();

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: {
    manipulate: () => {
      const context = {
        resize: () => context,
        renderAsync: async () => ({
          saveAsync: async () => ({
            uri: 'file:///still.jpg',
            width: 768,
            height: 432,
          }),
          release: jest.fn(),
        }),
        release: jest.fn(),
      };
      return context;
    },
  },
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('expo-video', () => ({
  createVideoPlayer: () => ({
    get status() {
      return mockPlayerStatus;
    },
    addListener: (
      event: string,
      listener: (payload: { status: typeof mockPlayerStatus }) => void
    ) => {
      if (event === 'statusChange') {
        statusChangeListener = listener;
      }
      return { remove: mockSubscriptionRemove };
    },
    generateThumbnailsAsync: () => mockGenerateThumbnailsAsync(),
    release: () => mockPlayerRelease(),
  }),
}));

jest.mock('expo-file-system', () => ({
  File: class MockFile {
    readonly size = 100_000;
  },
}));

describe('buildSwapStills video load readiness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlayerStatus = 'loading';
    statusChangeListener = undefined;
    mockGenerateThumbnailsAsync.mockResolvedValue([
      { width: 1920, height: 1080, release: jest.fn() },
    ]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function waitForListener() {
    for (let i = 0; i < 20 && !statusChangeListener; i += 1) {
      await Promise.resolve();
    }
    expect(statusChangeListener).toBeDefined();
  }

  it('waits until statusChange emits readyToPlay before extracting stills', async () => {
    const promise = buildSwapStills({
      kind: 'video',
      uri: 'file:///async.mov',
      durationMs: 4000,
    });

    await waitForListener();
    expect(mockGenerateThumbnailsAsync).not.toHaveBeenCalled();

    mockPlayerStatus = 'readyToPlay';
    statusChangeListener?.({ status: 'readyToPlay' });

    const stills = await promise;
    expect(stills).toHaveLength(4);
    expect(mockGenerateThumbnailsAsync).toHaveBeenCalledTimes(4);
    expect(mockSubscriptionRemove).toHaveBeenCalledTimes(1);
    expect(mockPlayerRelease).toHaveBeenCalledTimes(1);
  });

  it('rejects cleanly when video loading emits error or times out', async () => {
    const errorPromise = buildSwapStills({
      kind: 'video',
      uri: 'file:///broken.mov',
      durationMs: 4000,
    });
    await waitForListener();
    mockPlayerStatus = 'error';
    statusChangeListener?.({ status: 'error' });

    await expect(errorPromise).rejects.toThrow(UNREADABLE_VIDEO_MESSAGE);
    expect(mockSubscriptionRemove).toHaveBeenCalledTimes(1);
    expect(mockPlayerRelease).toHaveBeenCalledTimes(1);

    jest.useFakeTimers();
    mockPlayerStatus = 'loading';
    statusChangeListener = undefined;
    const timeoutPromise = buildSwapStills({
      kind: 'video',
      uri: 'file:///stalled.mov',
      durationMs: 4000,
    });
    const rejection = expect(timeoutPromise).rejects.toThrow(
      UNREADABLE_VIDEO_MESSAGE
    );
    await waitForListener();
    await jest.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(mockSubscriptionRemove).toHaveBeenCalledTimes(2);
    expect(mockPlayerRelease).toHaveBeenCalledTimes(2);
  });
});
