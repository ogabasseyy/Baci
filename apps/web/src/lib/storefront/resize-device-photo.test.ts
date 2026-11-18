// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resizeDevicePhoto } from './resize-device-photo';

interface FakePhoto {
  fails?: boolean;
  height: number;
  width: number;
}

/** An Image that "loads" on the next microtask with the given size. */
function installFakeImage(photo: FakePhoto) {
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob: (callback: (blob: Blob | null) => void, type: string) =>
      callback(new Blob(['photo'], { type })),
  };

  class FakeImage {
    naturalWidth = photo.width;
    naturalHeight = photo.height;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => (photo.fails ? this.onerror?.() : this.onload?.()));
    }
  }
  vi.stubGlobal('Image', FakeImage);

  const realCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'canvas'
      ? canvas
      : realCreateElement(tag)) as typeof document.createElement);

  return { canvas, drawImage };
}

function photoFile(): File {
  return new File(['photo'], 'device.jpg', { type: 'image/jpeg' });
}

describe('resizeDevicePhoto', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:device-photo');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns a JPEG scaled down to the size cap', async () => {
    const { canvas, drawImage } = installFakeImage({
      width: 4032,
      height: 3024,
    });

    const resized = await resizeDevicePhoto(photoFile());

    expect(resized.type).toBe('image/jpeg');
    expect(canvas).toMatchObject({ width: 768, height: 576 });
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:device-photo');
  });

  it('never enlarges a photo that is already small', async () => {
    const { canvas } = installFakeImage({ width: 400, height: 300 });

    await resizeDevicePhoto(photoFile());

    expect(canvas).toMatchObject({ width: 400, height: 300 });
  });

  it('rejects and releases the photo when the browser cannot decode it', async () => {
    installFakeImage({ width: 0, height: 0, fails: true });

    await expect(resizeDevicePhoto(photoFile())).rejects.toThrow(
      'Photo could not be read'
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:device-photo');
  });
});
