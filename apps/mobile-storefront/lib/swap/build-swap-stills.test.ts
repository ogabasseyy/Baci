import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  buildSwapStills,
  UNREADABLE_PHOTO_MESSAGE,
  UNREADABLE_VIDEO_MESSAGE,
} from './build-swap-stills';

type Resize = { resize: { width?: number; height?: number } };

const mockManipulateAsync =
  jest.fn<
    (
      uri: string,
      actions: Resize[],
      options: { compress: number; format: string }
    ) => Promise<{ uri: string }>
  >();
const mockGetThumbnailAsync =
  jest.fn<
    (
      uri: string,
      options: { time: number; quality: number }
    ) => Promise<{ uri: string; width: number; height: number }>
  >();

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (
    uri: string,
    actions: Resize[],
    options: { compress: number; format: string }
  ) => mockManipulateAsync(uri, actions, options),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: (
    uri: string,
    options: { time: number; quality: number }
  ) => mockGetThumbnailAsync(uri, options),
}));

describe('buildSwapStills', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockManipulateAsync.mockImplementation(async (uri) => ({
      uri: `${uri}.small.jpg`,
    }));
    mockGetThumbnailAsync.mockImplementation(async (_uri, { time }) => ({
      uri: `file:///frame-${time}.jpg`,
      width: 1920,
      height: 1080,
    }));
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
      'file:///wide.jpg.small.jpg',
      'file:///tall.jpg.small.jpg',
    ]);
    expect(mockManipulateAsync).toHaveBeenNthCalledWith(
      1,
      'file:///wide.jpg',
      [{ resize: { width: 768 } }],
      { compress: 0.8, format: 'jpeg' }
    );
    expect(mockManipulateAsync).toHaveBeenNthCalledWith(
      2,
      'file:///tall.jpg',
      [{ resize: { height: 768 } }],
      { compress: 0.8, format: 'jpeg' }
    );
  });

  it('never enlarges a photo that is already small', async () => {
    await buildSwapStills({
      kind: 'photos',
      photos: [{ uri: 'file:///small.jpg', width: 400, height: 300 }],
    });

    expect(mockManipulateAsync.mock.calls[0]?.[1]).toEqual([]);
  });

  it('still shrinks a photo whose size the picker did not report', async () => {
    await buildSwapStills({
      kind: 'photos',
      photos: [{ uri: 'file:///unknown.jpg', width: 0, height: 0 }],
    });

    expect(mockManipulateAsync.mock.calls[0]?.[1]).toEqual([
      { resize: { width: 768 } },
    ]);
  });

  it('reports a photo the phone cannot read', async () => {
    mockManipulateAsync.mockRejectedValueOnce(new Error('decode failed'));

    await expect(
      buildSwapStills({
        kind: 'photos',
        photos: [{ uri: 'file:///broken.heic', width: 100, height: 100 }],
      })
    ).rejects.toThrow(UNREADABLE_PHOTO_MESSAGE);
  });

  it('takes four stills spread across the video and shrinks them', async () => {
    const stills = await buildSwapStills({
      kind: 'video',
      uri: 'file:///device.mov',
      durationMs: 8000,
    });

    expect(
      mockGetThumbnailAsync.mock.calls.map((call) => call[1].time)
    ).toEqual([1000, 3000, 5000, 7000]);
    expect(stills).toEqual([
      'file:///frame-1000.jpg.small.jpg',
      'file:///frame-3000.jpg.small.jpg',
      'file:///frame-5000.jpg.small.jpg',
      'file:///frame-7000.jpg.small.jpg',
    ]);
    expect(mockManipulateAsync).toHaveBeenCalledWith(
      'file:///frame-1000.jpg',
      [{ resize: { width: 768 } }],
      { compress: 0.8, format: 'jpeg' }
    );
  });

  it('keeps the stills it could take when the clip length is unknown', async () => {
    mockGetThumbnailAsync.mockImplementation(async (_uri, { time }) => {
      if (time > 1500) throw new Error('past the end');
      return { uri: `file:///frame-${time}.jpg`, width: 640, height: 360 };
    });

    const stills = await buildSwapStills({
      kind: 'video',
      uri: 'file:///short.mov',
      durationMs: null,
    });

    expect(stills).toEqual([
      'file:///frame-0.jpg.small.jpg',
      'file:///frame-1500.jpg.small.jpg',
    ]);
  });

  it('reports a video no still could be taken from', async () => {
    mockGetThumbnailAsync.mockRejectedValue(new Error('unsupported'));

    await expect(
      buildSwapStills({
        kind: 'video',
        uri: 'file:///odd.avi',
        durationMs: 5000,
      })
    ).rejects.toThrow(UNREADABLE_VIDEO_MESSAGE);
  });
});
