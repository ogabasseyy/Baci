import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNextImageMock } from './vitest.next-image-mock';

type ImgElement = ReactElement<Record<string, unknown>, 'img'>;

afterEach(() => {
  vi.doUnmock('react');
  vi.resetModules();
});

describe('createNextImageMock default component', () => {
  it('renders a plain <img> and forwards the other props', async () => {
    const { default: Image } = await createNextImageMock();

    const element = Image({
      src: '/a.png',
      alt: 'Product',
      className: 'hero',
      width: 40,
    }) as ImgElement;

    expect(element.type).toBe('img');
    expect(element.props).toEqual({
      src: '/a.png',
      alt: 'Product',
      className: 'hero',
      width: 40,
    });
  });

  it.each([
    ['a string', '/string.png', '/string.png'],
    ['an object with src', { src: '/object.png' }, '/object.png'],
    [
      'a statically imported module',
      { default: { src: '/module.png' } },
      '/module.png',
    ],
  ])('accepts %s as the image source', async (_label, src, expected) => {
    const { default: Image } = await createNextImageMock();

    const element = Image({ src, alt: '' }) as ImgElement;

    expect(element.props.src).toBe(expected);
  });

  it('leaves the source undefined when none is given', async () => {
    const { default: Image } = await createNextImageMock();

    const element = Image({ alt: 'No source' }) as ImgElement;

    expect(element.props.src).toBeUndefined();
  });
});

describe('createNextImageMock getImageProps', () => {
  it('drops the next/image-only options and keeps the rest', async () => {
    const { getImageProps } = await createNextImageMock();

    const result = getImageProps({
      src: '/a.png',
      alt: 'Product',
      fill: true,
      priority: true,
      loader: () => '/loaded.png',
      quality: 75,
      preload: true,
      sizes: '100vw',
      width: 40,
    });

    expect(result).toEqual({
      props: { src: '/a.png', alt: 'Product', sizes: '100vw', width: 40 },
    });
  });

  it('defaults alt to an empty string and normalizes the source', async () => {
    const { getImageProps } = await createNextImageMock();

    const result = getImageProps({ src: { default: { src: '/module.png' } } });

    expect(result).toEqual({ props: { src: '/module.png', alt: '' } });
  });
});

describe('createNextImageMock when a suite mocks react', () => {
  it('still builds elements with the real React', async () => {
    // A suite that replaces react (for example to stub `cache`) must not break
    // every mocked <Image> it renders: the factory loads the actual module.
    vi.doMock('react', () => ({ default: {}, createElement: undefined }));
    vi.resetModules();
    const { createNextImageMock: freshFactory } = await import(
      './vitest.next-image-mock'
    );

    const { default: Image } = await freshFactory();
    const element = Image({ src: '/a.png', alt: 'Product' }) as ImgElement;

    expect(element.type).toBe('img');
    expect(element.props.src).toBe('/a.png');
  });
});
