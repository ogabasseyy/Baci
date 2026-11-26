import { describe, expect, it } from 'vitest';
import { boundImageFormatImgProps } from './ogabassey-image-srcset-bounds';

const CDN = 'https://cdn.ogabassey.com';

describe('boundImageFormatImgProps', () => {
  it('caps w-descriptor srcSet candidates to [minSrcSetWidth, maxSrcSetWidth] and updates src', () => {
    const cover = '/core-assets/blog/post/cover.jpg';
    const bounded = boundImageFormatImgProps(
      {
        alt: 'Blog card',
        src: `${CDN}/image/width=1080,quality=50,format=jpeg${cover}`,
        srcSet: [256, 384, 640, 750, 828, 1080]
          .map(
            (w) =>
              `${CDN}/image/width=${w},quality=50,format=jpeg${cover} ${w}w`
          )
          .join(', '),
      },
      384,
      750
    );

    expect(bounded.srcSet).toBe(
      [384, 640, 750]
        .map(
          (w) => `${CDN}/image/width=${w},quality=50,format=jpeg${cover} ${w}w`
        )
        .join(', ')
    );
    expect(bounded.src).toBe(
      `${CDN}/image/width=750,quality=50,format=jpeg${cover}`
    );
  });

  it('preserves an explicit overrideSrc when top candidates are trimmed', () => {
    const bounded = boundImageFormatImgProps(
      {
        alt: 'Blog card',
        src: '/legacy-cover.jpg',
        srcSet: `${CDN}/image/width=384,quality=50,format=jpeg/cover.jpg 384w, ${CDN}/image/width=828,quality=50,format=jpeg/cover.jpg 828w`,
      },
      384,
      750,
      true
    );

    expect(bounded.src).toBe('/legacy-cover.jpg');
    expect(bounded.srcSet).toBe(
      `${CDN}/image/width=384,quality=50,format=jpeg/cover.jpg 384w`
    );
  });

  it('reads query w= and preserves width= segments inside asset paths', () => {
    const capped = boundImageFormatImgProps(
      {
        alt: 'Path token test',
        src: '/images/width=1200/cover.jpg?w=1080&q=75',
        srcSet:
          '/images/width=1200/cover.jpg?w=640&q=75 1x, /images/width=1200/cover.jpg?w=1080&q=75 2x',
      },
      undefined,
      750
    );

    expect(capped.srcSet).toBe('/images/width=1200/cover.jpg?w=640&q=75 1x');
    expect(capped.src).toBe('/images/width=1200/cover.jpg?w=640&q=75');

    const clampedBelowMinCandidate = boundImageFormatImgProps(
      {
        alt: 'Clamped query test',
        src: '/images/width=1200/cover.jpg?w=1080&q=75',
        srcSet:
          '/images/width=1200/cover.jpg?w=640&q=75 1x, /images/width=1200/cover.jpg?w=1080&q=75 2x',
      },
      undefined,
      500
    );

    expect(clampedBelowMinCandidate.srcSet).toBe(
      '/images/width=1200/cover.jpg?w=500&q=75 1x'
    );
    expect(clampedBelowMinCandidate.src).toBe(
      '/images/width=1200/cover.jpg?w=500&q=75'
    );
  });

  it('rewrites only the CDN transform options width= token and leaves path width= intact', () => {
    const asset = '/core-assets/blog/width=1200/cover.jpg';
    const clamped = boundImageFormatImgProps(
      {
        alt: 'CDN nested width token',
        src: `${CDN}/image/width=1080,quality=50,format=jpeg${asset}`,
        srcSet: `${CDN}/image/width=1080,quality=50,format=jpeg${asset} 1x, ${CDN}/image/width=1920,quality=50,format=jpeg${asset} 2x`,
      },
      undefined,
      750
    );

    expect(clamped.srcSet).toBe(
      `${CDN}/image/width=750,quality=50,format=jpeg${asset} 1x`
    );
    expect(clamped.src).toBe(
      `${CDN}/image/width=750,quality=50,format=jpeg${asset}`
    );
  });

  it('bounds descriptorless CDN transform candidates and leaves unparameterized density srcSets untouched', () => {
    const descriptorless = boundImageFormatImgProps(
      {
        alt: 'Same origin proxy',
        src: '/cdn-image/width=1080,quality=50,format=jpeg/core-assets/blog/cover.jpg',
        srcSet:
          '/cdn-image/width=1080,quality=50,format=jpeg/core-assets/blog/cover.jpg',
      },
      undefined,
      750
    );
    expect(descriptorless.srcSet).toBe(
      '/cdn-image/width=750,quality=50,format=jpeg/core-assets/blog/cover.jpg'
    );

    const staticDensity = boundImageFormatImgProps(
      {
        alt: 'Static density',
        src: '/static/cover@2x.jpg',
        srcSet: '/static/cover.jpg 1x, /static/cover@2x.jpg 2x',
      },
      384,
      750
    );
    expect(staticDensity.srcSet).toBe(
      '/static/cover.jpg 1x, /static/cover@2x.jpg 2x'
    );
    expect(staticDensity.src).toBe('/static/cover@2x.jpg');
  });
});
