import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnowEffect } from './SnowEffect';

vi.mock('../providers/v2-theme-context', () => ({
  useV2Theme: () => ({ theme: 'santa' }),
}));

function stubMatchMedia(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('SnowEffect', () => {
  const raf = vi.fn(() => 1);

  beforeEach(() => {
    raf.mockClear();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
    })) as unknown as HTMLCanvasElement['getContext'];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('animates the snow canvas when motion is allowed', () => {
    stubMatchMedia(false);
    const { container } = render(<SnowEffect />);
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(raf).toHaveBeenCalled();
  });

  it('renders nothing and never animates when the shopper prefers reduced motion', () => {
    stubMatchMedia(true);
    const { container } = render(<SnowEffect />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(raf).not.toHaveBeenCalled();
  });
});
