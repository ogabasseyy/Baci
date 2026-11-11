// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractBrandColorsFromImage } from './extract-brand-colors';

describe('extractBrandColorsFromImage', () => {
  const originalCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts primary and accent colors from image pixels', async () => {
    const drawImage = vi.fn();
    const getImageData = vi.fn(() => ({
      data: new Uint8ClampedArray([
        255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255,
      ]),
    }));

    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        drawImage,
        getImageData,
      })),
    } as unknown as HTMLCanvasElement;

    const image = {
      crossOrigin: null as string | null,
      width: 4,
      height: 1,
      naturalWidth: 4,
      naturalHeight: 1,
      onload: null as null | (() => void),
      onerror: null as null | (() => void),
    } as unknown as HTMLImageElement;

    Object.defineProperty(image, 'src', {
      set() {
        image.onload?.(new Event('load'));
      },
    });

    vi.spyOn(document, 'createElement').mockImplementation(
      (tagName: string) => {
        if (tagName === 'img') {
          return image;
        }

        if (tagName === 'canvas') {
          return canvas;
        }

        return originalCreateElement(tagName);
      }
    );

    await expect(
      extractBrandColorsFromImage('data:image/png;base64,test')
    ).resolves.toEqual({
      primary: '#ff0000',
      background: '#FFFFFF',
      accent: '#00ff00',
    });

    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(getImageData).toHaveBeenCalledTimes(1);
  });

  it('rejects when the image cannot be loaded', async () => {
    const image = {
      crossOrigin: null as string | null,
      onload: null as null | (() => void),
      onerror: null as null | (() => void),
    } as unknown as HTMLImageElement;

    Object.defineProperty(image, 'src', {
      set() {
        image.onerror?.(new Event('error'));
      },
    });

    vi.spyOn(document, 'createElement').mockImplementation(
      (tagName: string) => {
        if (tagName === 'img') {
          return image;
        }

        return originalCreateElement(tagName);
      }
    );

    await expect(
      extractBrandColorsFromImage('data:image/png;base64,broken')
    ).rejects.toThrow('Image could not be loaded for color extraction.');
  });
});
