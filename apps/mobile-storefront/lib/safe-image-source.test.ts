import { resolveSafeImageSource } from './safe-image-source';

describe('resolveSafeImageSource', () => {
  it('leaves arbitrary Supabase URLs unchanged', () => {
    const uri =
      'https://project.supabase.co/storage/v1/object/public/products/phone.avif';

    expect(resolveSafeImageSource({ height: 120, uri, width: 100 })).toEqual({
      height: 120,
      uri,
      width: 100,
    });
  });

  it('adds cover fitting when normalizing a managed string source', () => {
    expect(
      resolveSafeImageSource(
        'https://cdn.ogabassey.com/core-assets/products/phone.avif',
        { fit: 'cover' }
      )
    ).toBe(
      'https://cdn.ogabassey.com/image/quality=82,format=webp,fit=cover/core-assets/products/phone.avif'
    );
  });
});
