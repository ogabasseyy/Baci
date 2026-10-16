import { preload } from 'react-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PilotLabFlightPreload } from './lab-flight-preload';
import type { ProjectedOgabasseyMobile } from './ogabassey-mobile-adapter';

type ReactDomModule = typeof import('react-dom');

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<ReactDomModule>();
  return { ...actual, preload: vi.fn() };
});

const projection: ProjectedOgabasseyMobile = {
  alt: 'Hero mobile',
  avifSrcSet: '/__pilot/384.avif 384w',
  fallbackSrcSet: '/__pilot/384.webp 384w',
  imageFit: 'contain',
  imgSrc: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  media: '(max-width: 768px)',
  preload: {
    fetchPriority: 'high',
    href: '/__pilot/384.avif',
    imageSizes: '40vw',
    imageSrcSet: '/__pilot/384.avif 384w',
    media: '(max-width: 768px)',
    type: 'image/avif',
  },
  sizes: '40vw',
};

describe('PilotLabFlightPreload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards the default projection preload type and honors null override', () => {
    expect(PilotLabFlightPreload({ projection })).toBeNull();
    expect(preload).toHaveBeenCalledWith('/__pilot/384.avif', {
      as: 'image',
      fetchPriority: 'high',
      imageSizes: '40vw',
      imageSrcSet: '/__pilot/384.avif 384w',
      media: '(max-width: 768px)',
      type: 'image/avif',
    });

    expect(PilotLabFlightPreload({ projection, type: null })).toBeNull();
    expect(preload).toHaveBeenLastCalledWith('/__pilot/384.avif', {
      as: 'image',
      fetchPriority: 'high',
      imageSizes: '40vw',
      imageSrcSet: '/__pilot/384.avif 384w',
      media: '(max-width: 768px)',
      type: undefined,
    });
  });
});
