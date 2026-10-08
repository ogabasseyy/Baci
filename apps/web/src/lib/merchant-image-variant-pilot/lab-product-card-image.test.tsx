import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { labCardSlot, labProductFixture } from './lab-fixtures';
import { LabProductCardImage } from './lab-product-card-image';
import { projectControlNextImage } from './next-image-adapter';

function mount() {
  const product = labProductFixture({
    name: 'Decode fixture',
    imageLarge: 'https://example.com/image.png',
    imageHint: 'test',
  });
  const projection = projectControlNextImage({
    originalUrl: '/test.png',
    slot: labCardSlot(product, { priority: false }),
  });
  const view = render(
    <LabProductCardImage
      imageHint="test"
      placeholder="data:image/png;base64,AAAA"
      projection={projection}
    />
  );
  const image = screen.getByRole('img') as HTMLImageElement;
  return { ...view, image, picture: image.parentElement };
}

describe('LabProductCardImage decode parity', () => {
  it('retains the blur after load until decode settles', async () => {
    const { image, picture } = mount();
    let finish: () => void = () => {};
    const decode = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    Object.defineProperty(image, 'decode', { value: decode });
    fireEvent.load(image);
    expect(decode).toHaveBeenCalledOnce();
    expect(picture?.style.backgroundImage).not.toBe('');
    await act(async () => {
      finish();
    });
    expect(picture?.style.backgroundImage).toBe('');
  });

  it('handles decode rejection like Next Image', async () => {
    const { image, picture } = mount();
    Object.defineProperty(image, 'decode', {
      value: () => Promise.reject(new Error('decode failed')),
    });
    await act(async () => {
      fireEvent.load(image);
    });
    expect(picture?.style.backgroundImage).toBe('');
  });

  it('does not update a detached image after decode', async () => {
    const { image, picture, unmount } = mount();
    let finish: () => void = () => {};
    Object.defineProperty(image, 'decode', {
      value: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    fireEvent.load(image);
    unmount();
    await act(async () => {
      finish();
    });
    expect(picture?.style.backgroundImage).not.toBe('');
  });

  it('clears the blur for an image already complete before hydration', async () => {
    // A manually preloaded candidate can finish before hydration attaches
    // onLoad: no load event ever fires, so the ref callback must clear
    // through the same decode path.
    const complete = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      'complete'
    );
    const naturalWidth = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      'naturalWidth'
    );
    Object.defineProperty(HTMLImageElement.prototype, 'complete', {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      configurable: true,
      get: () => 48,
    });
    try {
      const { picture } = mount();
      await act(async () => {});
      expect(picture?.style.backgroundImage).toBe('');
    } finally {
      if (complete) {
        Object.defineProperty(HTMLImageElement.prototype, 'complete', complete);
      }
      if (naturalWidth) {
        Object.defineProperty(
          HTMLImageElement.prototype,
          'naturalWidth',
          naturalWidth
        );
      }
    }
  });
});
