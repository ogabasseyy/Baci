import type { ImgHTMLAttributes } from 'react';
import { vi } from 'vitest';

type MockImageSrc = string | { src: string } | { default: { src: string } };

// `src` is replaced, not intersected: ImgHTMLAttributes already types it as a
// string, which would hide the object shapes statically imported images have.
type MockNextImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: MockImageSrc;
  alt?: string;
};

function normalizeMockImageSrc(src?: MockImageSrc): string | undefined {
  return typeof src === 'string'
    ? src
    : src && 'default' in src
      ? src.default.src
      : src?.src;
}

/**
 * Module factory for the global `next/image` mock. React is imported lazily so
 * the node Vitest project only loads it when a test actually pulls in
 * `next/image`. `importActual` keeps the mock on the real React even when a
 * test mocks `react` itself, as the old eager setup import did.
 */
export async function createNextImageMock() {
  const React = await vi.importActual<typeof import('react')>('react');

  return {
    default: ({ src, alt, ...props }: MockNextImageProps) =>
      React.createElement('img', {
        src: normalizeMockImageSrc(src),
        alt,
        ...props,
      }),
    // `getImageProps` powers the per-format `<picture>` pipeline (CdnFormatImage /
    // ogabassey-image-format-sources). Mirror the default mock: raw-src
    // passthrough with NO srcSet, so CdnFormatImage's AVIF-tier derivation finds
    // no transform twin and renders a plain <img> — identical to the default mock
    // above and to the pre-migration `<Image>`. Tests asserting the REAL
    // per-format srcSet re-mock next/image with `importOriginal` in-file.
    getImageProps: ({
      src,
      alt,
      fill: _fill,
      priority: _priority,
      loader: _loader,
      quality: _quality,
      preload: _preload,
      ...props
    }: MockNextImageProps & {
      fill?: boolean;
      priority?: boolean;
      loader?: unknown;
      quality?: number;
      preload?: boolean;
    }) => ({
      props: { ...props, src: normalizeMockImageSrc(src), alt: alt ?? '' },
    }),
  };
}
