import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../types';
import { HomeProductGridGate } from './home-product-grid-gate';

const mocks = vi.hoisted(() => ({
  // The gate defers to the post-LCP signal; resolve immediately so timing
  // stays deterministic under jsdom, which never emits LCP entries.
  waitForLcpWindowEnd: vi.fn(async () => undefined),
}));

vi.mock('@/lib/posthog/wait-for-lcp', () => ({
  waitForLcpWindowEnd: mocks.waitForLcpWindowEnd,
}));

const stubProduct: Product = {
  id: 'product-1',
  name: 'iPhone 17 Pro Max',
  price: '₦2,100,000',
  image: '/iphone.jpg',
  description: 'Flagship phone.',
};

function renderGateWithPictureFallback() {
  const pendingGridModule = new Promise<never>(() => {});
  return render(
    <HomeProductGridGate
      fallback={
        <picture>
          <source
            srcSet="https://cdn.example.com/p/format=avif/x-640.jpg 640w"
            type="image/avif"
          />
          {/* biome-ignore lint/performance/noImgElement: raw markup probe for the delegated handler. */}
          <img
            alt="Phone"
            data-avif-recover=""
            src="https://cdn.example.com/p/format=jpeg/x-640.jpg"
          />
        </picture>
      }
      loadGridModule={() => pendingGridModule}
      products={[stubProduct]}
      timeoutMs={10000}
    />
  );
}

function mockCurrentSrc(img: HTMLImageElement, currentSrc: string) {
  Object.defineProperty(img, 'currentSrc', {
    configurable: true,
    value: currentSrc,
  });
}

describe('HomeProductGridGate AVIF recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops a failed AVIF tier in the static fallback via delegated capture', () => {
    // The fallback image is server-rendered zero-JS, so the already-client
    // gate recovers a failed AVIF tier: dropping the source lets the
    // in-tree JPEG fallback render without a client boundary in the
    // fallback module.
    const { container } = renderGateWithPictureFallback();

    expect(
      container.querySelector('source[type="image/avif"]')
    ).not.toBeNull();

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    mockCurrentSrc(
      image as HTMLImageElement,
      'https://cdn.example.com/p/format=avif/x-640.jpg'
    );
    fireEvent.error(image as HTMLImageElement);

    expect(
      container.querySelector('source[type="image/avif"]')
    ).toBeNull();
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.com/p/format=jpeg/x-640.jpg'
    );
  });

  it('ignores image errors outside delegated AVIF recovery', () => {
    // JPEG-tier failures have no further fallback here, and the
    // interactive grid's own images (no marker) carry their own recovery.
    const { container } = renderGateWithPictureFallback();

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    mockCurrentSrc(
      image as HTMLImageElement,
      'https://cdn.example.com/p/format=jpeg/x-640.jpg'
    );
    fireEvent.error(image as HTMLImageElement);

    expect(
      container.querySelector('source[type="image/avif"]')
    ).not.toBeNull();
  });
});
