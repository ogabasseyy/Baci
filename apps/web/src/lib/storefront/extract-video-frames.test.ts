// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractVideoFrames } from './extract-video-frames';

interface FakeVideoOptions {
  duration: number;
  fails?: boolean;
  readyState?: number;
  height: number;
  width: number;
}

/** A video element that "loads" and "seeks" on the next microtask. */
function installFakeMedia(options: FakeVideoOptions) {
  const seekTimes: number[] = [];
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob: (callback: (blob: Blob | null) => void, type: string) =>
      callback(new Blob(['frame'], { type })),
  };

  const realCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'canvas') return canvas;
    if (tag !== 'video') return realCreateElement(tag);

    const video = realCreateElement('video');
    Object.defineProperties(video, {
      videoWidth: { get: () => options.width },
      videoHeight: { get: () => options.height },
      duration: { get: () => options.duration },
      src: {
        set: () => {
          queueMicrotask(() =>
            video.dispatchEvent(
              new Event(options.fails ? 'error' : 'loadedmetadata')
            )
          );
        },
      },
      currentTime: {
        set: (time: number) => {
          seekTimes.push(time);
          queueMicrotask(() => video.dispatchEvent(new Event('seeked')));
        },
      },
      readyState: { get: () => options.readyState ?? 4 },
      load: { value: () => {} },
    });
    return video;
  }) as typeof document.createElement);

  return { canvas, drawImage, seekTimes };
}

describe('extractVideoFrames', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:device-video');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => vi.restoreAllMocks());

  it('returns four evenly spaced JPEG frames scaled to the size cap', async () => {
    const { canvas, drawImage, seekTimes } = installFakeMedia({
      duration: 8,
      width: 1920,
      height: 1080,
    });

    const frames = await extractVideoFrames(
      new File(['video'], 'device.mp4', { type: 'video/mp4' })
    );

    expect(frames).toHaveLength(4);
    expect(frames.every((frame) => frame.type === 'image/jpeg')).toBe(true);
    expect(seekTimes).toEqual([1, 3, 5, 7]);
    expect(canvas).toMatchObject({ width: 768, height: 432 });
    expect(drawImage).toHaveBeenCalledTimes(4);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:device-video');
  });

  it.each([
    ['zero', 0],
    ['unknown (Infinity)', Number.POSITIVE_INFINITY],
  ])('takes one frame without seeking when the duration is %s', async (_label, duration) => {
    const { drawImage, seekTimes } = installFakeMedia({
      duration,
      width: 640,
      height: 480,
    });

    const frames = await extractVideoFrames(
      new File(['video'], 'recording.webm', { type: 'video/webm' })
    );

    expect(frames).toHaveLength(1);
    expect(seekTimes).toEqual([]);
    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it('rejects and releases the video when the browser cannot decode it', async () => {
    installFakeMedia({ duration: 8, width: 1920, height: 1080, fails: true });

    await expect(
      extractVideoFrames(
        new File(['video'], 'device.mov', { type: 'video/quicktime' })
      )
    ).rejects.toThrow('Video could not be read');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:device-video');
  });
});
