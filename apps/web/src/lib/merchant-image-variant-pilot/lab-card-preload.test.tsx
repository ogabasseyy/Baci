import { preload } from 'react-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PilotLabCardPreload } from './lab-card-preload';
import type { ProjectedPilotImage } from './next-image-adapter';

type ReactDomModule = typeof import('react-dom');

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<ReactDomModule>();
  return { ...actual, preload: vi.fn() };
});

const baseProjection: ProjectedPilotImage = {
  alt: 'Card image',
  fallbackSrc: '/__pilot/originals/card.png',
  fetchPriority: 'high',
  height: 300,
  loading: 'eager',
  sizes: '50vw',
  sources: [
    {
      format: 'avif',
      srcSet: '/__pilot/tiers/384.avif 384w, /__pilot/tiers/768.avif 768w',
    },
    {
      format: 'webp',
      srcSet: '/__pilot/tiers/384.webp 384w, /__pilot/tiers/768.webp 768w',
    },
  ],
  width: 300,
};

describe('PilotLabCardPreload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preloads the AVIF source set when an AVIF source is present', () => {
    expect(PilotLabCardPreload({ projection: baseProjection })).toBeNull();
    expect(preload).toHaveBeenCalledWith('/__pilot/tiers/384.avif', {
      as: 'image',
      fetchPriority: 'high',
      imageSizes: '50vw',
      imageSrcSet: '/__pilot/tiers/384.avif 384w, /__pilot/tiers/768.avif 768w',
      type: 'image/avif',
    });
  });

  it('preloads the fallback source when no AVIF source is present', () => {
    const controlProjection: ProjectedPilotImage = {
      ...baseProjection,
      sources: [],
    };
    expect(PilotLabCardPreload({ projection: controlProjection })).toBeNull();
    expect(preload).toHaveBeenCalledWith('/__pilot/originals/card.png', {
      as: 'image',
      fetchPriority: 'high',
      imageSizes: '50vw',
    });
  });
});
