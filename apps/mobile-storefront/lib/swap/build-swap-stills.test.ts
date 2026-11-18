import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  buildSwapStills,
  SWAP_STILLS_MAX_BYTES,
  UNREADABLE_PHOTO_MESSAGE,
  UNREADABLE_VIDEO_MESSAGE,
  UPLOAD_TOO_LARGE_MESSAGE,
} from './build-swap-stills';

type SaveOptions = { compress: number; format: string };
type SavedImage = { uri: string; width: number; height: number };

const mockResize =
  jest.fn<(size: { width?: number; height?: number }) => void>();
const mockSaveAsync =
  jest.fn<(source: unknown, options: SaveOptions) => Promise<SavedImage>>();
const mockContextRelease = jest.fn<() => void>();
const mockRenderRelease = jest.fn<() => void>();
const mockManipulate = jest.fn<(source: unknown) => void>();

const mockCreateVideoPlayer = jest.fn<(uri: string) => void>();
const mockGenerateThumbnailsAsync =
  jest.fn<
    (
      uri: string,
      timeSec: number
    ) => Promise<Array<{ width: number; height: number; release?: () => void }>>
  >();
const mockPlayerRelease = jest.fn<() => void>();
const mockThumbnailRelease = jest.fn<() => void>();
const mockGetFileSize = jest.fn<(uri: string) => number>();

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: {
    manipulate: (source: unknown) => {
      mockManipulate(source);
      const context = {
        resize: (size: { width?: number; height?: number }) => {
          mockResize(size);
          return context;
        },
        renderAsync: async () => ({
          saveAsync: (options: SaveOptions) => mockSaveAsync(source, options),
          release: () => mockRenderRelease(),
        }),
        release: () => mockContextRelease(),
      };
      return context;
    },
  },
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('expo-video', () => ({
  createVideoPlayer: (uri: string) => {
    mockCreateVideoPlayer(uri);
    return {
      status: 'readyToPlay',
      addListener: () => ({ remove: jest.fn() }),
      generateThumbnailsAsync: (timeSec: number) =>
        mockGenerateThumbnailsAsync(uri, timeSec),
      release: () => mockPlayerRelease(),
    };
  },
}));

jest.mock('expo-file-system', () => ({
  File: class MockFile {
    readonly size: number;
    constructor(uri: string) {
      this.size = mockGetFileSize(uri);
    }
  },
}));

describe('buildSwapStills', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFileSize.mockReturnValue(100_000);
    mockSaveAsync.mockImplementation(async (source, options) => {
      const label =
        typeof source === 'string'
          ? source
          : `file:///thumb-${(source as { timeSec: number }).timeSec}.jpg`;
      return {
        uri: `${label}.q${options.compress}.jpg`,
        width: 768,
        height: 576,
      };
    });
    mockGenerateThumbnailsAsync.mockImplementation(async (_uri, timeSec) => [
      Object.assign(
        { width: 1920, height: 1080, release: () => mockThumbnailRelease() },
        { timeSec }
      ),
    ]);
  });

  it('shrinks each photo to a small JPEG, in the order picked', async () => {
    const stills = await buildSwapStills({
      kind: 'photos',
      photos: [
        { uri: 'file:///wide.jpg', width: 4032, height: 3024 },
        { uri: 'file:///tall.jpg', width: 3024, height: 4032 },
      ],
    });

    expect(stills).toEqual([
      'file:///wide.jpg.q0.8.jpg',
      'file:///tall.jpg.q0.8.jpg',
    ]);
    expect(mockManipulate).toHaveBeenNthCalledWith(1, 'file:///wide.jpg');
    expect(mockResize).toHaveBeenNthCalledWith(1, { width: 768 });
    expect(mockManipulate).toHaveBeenNthCalledWith(2, 'file:///tall.jpg');
    expect(mockResize).toHaveBeenNthCalledWith(2, { height: 768 });
    expect(mockSaveAsync).toHaveBeenCalledWith('file:///wide.jpg', {
      compress: 0.8,
      format: 'jpeg',
    });
    expect(mockContextRelease).toHaveBeenCalledTimes(2);
    expect(mockRenderRelease).toHaveBeenCalledTimes(2);
  });

  it('never enlarges a photo that is already small', async () => {
    await buildSwapStills({
      kind: 'photos',
      photos: [{ uri: 'file:///small.jpg', width: 400, height: 300 }],
    });

    expect(mockResize).not.toHaveBeenCalled();
  });

  it('still shrinks a photo whose size the picker did not report', async () => {
    await buildSwapStills({
      kind: 'photos',
      photos: [{ uri: 'file:///unknown.jpg', width: 0, height: 0 }],
    });

    expect(mockResize).toHaveBeenCalledWith({ width: 768 });
  });

  it('reports a photo the phone cannot read', async () => {
    mockSaveAsync.mockRejectedValueOnce(new Error('decode failed'));

    await expect(
      buildSwapStills({
        kind: 'photos',
        photos: [{ uri: 'file:///broken.heic', width: 100, height: 100 }],
      })
    ).rejects.toThrow(UNREADABLE_PHOTO_MESSAGE);
  });

  it('takes four stills spread across the video in seconds, shrinks them, and releases resources', async () => {
    const stills = await buildSwapStills({
      kind: 'video',
      uri: 'file:///device.mov',
      durationMs: 8000,
    });

    expect(mockCreateVideoPlayer).toHaveBeenCalledWith('file:///device.mov');
    expect(
      mockGenerateThumbnailsAsync.mock.calls.map((call) => call[1])
    ).toEqual([1, 3, 5, 7]);
    expect(stills).toEqual([
      'file:///thumb-1.jpg.q0.8.jpg',
      'file:///thumb-3.jpg.q0.8.jpg',
      'file:///thumb-5.jpg.q0.8.jpg',
      'file:///thumb-7.jpg.q0.8.jpg',
    ]);
    expect(mockResize).toHaveBeenCalledWith({ width: 768 });
    expect(mockThumbnailRelease).toHaveBeenCalledTimes(4);
    expect(mockPlayerRelease).toHaveBeenCalledTimes(1);
  });

  it('keeps the stills it could take when the clip length is unknown', async () => {
    mockGenerateThumbnailsAsync.mockImplementation(async (_uri, timeSec) => {
      if (timeSec > 1.5) throw new Error('past the end');
      return [
        Object.assign(
          { width: 640, height: 360, release: () => mockThumbnailRelease() },
          { timeSec }
        ),
      ];
    });

    const stills = await buildSwapStills({
      kind: 'video',
      uri: 'file:///short.mov',
      durationMs: null,
    });

    expect(stills).toEqual([
      'file:///thumb-0.jpg.q0.8.jpg',
      'file:///thumb-1.5.jpg.q0.8.jpg',
    ]);
    expect(mockPlayerRelease).toHaveBeenCalledTimes(1);
  });

  it('surfaces shrink failures during video still generation instead of returning partial frames', async () => {
    mockSaveAsync
      .mockResolvedValueOnce({
        uri: 'file:///thumb-1.jpg.q0.8.jpg',
        width: 768,
        height: 432,
      })
      .mockRejectedValueOnce(new Error('out of memory'));

    await expect(
      buildSwapStills({
        kind: 'video',
        uri: 'file:///device.mov',
        durationMs: 8000,
      })
    ).rejects.toThrow(UNREADABLE_VIDEO_MESSAGE);
    expect(mockThumbnailRelease).toHaveBeenCalledTimes(2);
    expect(mockPlayerRelease).toHaveBeenCalledTimes(1);
  });

  it('reports a video no still could be taken from', async () => {
    mockGenerateThumbnailsAsync.mockRejectedValue(new Error('unsupported'));

    await expect(
      buildSwapStills({
        kind: 'video',
        uri: 'file:///odd.avi',
        durationMs: 5000,
      })
    ).rejects.toThrow(UNREADABLE_VIDEO_MESSAGE);
    expect(mockPlayerRelease).toHaveBeenCalledTimes(1);
  });

  it('downscales stills when the initial batch exceeds the upload byte budget', async () => {
    mockGetFileSize.mockImplementation((uri) =>
      uri.endsWith('.q0.8.jpg') ? 400_000 : 250_000
    );

    const photos = Array.from({ length: 6 }, (_, index) => ({
      uri: `file:///p${index}.jpg`,
      width: 4032,
      height: 3024,
    }));

    const stills = await buildSwapStills({ kind: 'photos', photos });

    expect(stills).toHaveLength(6);
    expect(stills.every((uri) => uri.endsWith('.q0.65.jpg'))).toBe(true);
    expect(
      stills.reduce((sum, uri) => sum + mockGetFileSize(uri), 0)
    ).toBeLessThanOrEqual(SWAP_STILLS_MAX_BYTES);
  });

  it('rejects when even the smallest quality tier exceeds the upload byte budget', async () => {
    mockGetFileSize.mockReturnValue(600_000);

    const photos = Array.from({ length: 5 }, (_, index) => ({
      uri: `file:///p${index}.jpg`,
      width: 4032,
      height: 3024,
    }));

    await expect(buildSwapStills({ kind: 'photos', photos })).rejects.toThrow(
      UPLOAD_TOO_LARGE_MESSAGE
    );
  });

  it('rejects when even a single still exceeds the upload byte budget', async () => {
    mockGetFileSize.mockReturnValue(SWAP_STILLS_MAX_BYTES + 1);

    await expect(
      buildSwapStills({
        kind: 'photos',
        photos: [{ uri: 'file:///huge.jpg', width: 4032, height: 3024 }],
      })
    ).rejects.toThrow(UPLOAD_TOO_LARGE_MESSAGE);
  });
});
