import { describe, expect, it } from '@jest/globals';
import { type SwapPickedAsset, selectSwapMedia } from './select-swap-media';

function photo(name = 'front'): SwapPickedAsset {
  return {
    uri: `file:///${name}.jpg`,
    type: 'image',
    width: 4032,
    height: 3024,
  };
}

function video(name = 'device'): SwapPickedAsset {
  return { uri: `file:///${name}.mov`, type: 'video', duration: 12_000 };
}

describe('selectSwapMedia', () => {
  it('accepts one video and keeps its length', () => {
    expect(selectSwapMedia([video()])).toEqual({
      ok: true,
      media: { kind: 'video', uri: 'file:///device.mov', durationMs: 12_000 },
      label: 'Video selected',
    });
  });

  it('treats a missing video length as unknown', () => {
    const selection = selectSwapMedia([{ ...video(), duration: null }]);

    expect(selection).toMatchObject({
      ok: true,
      media: { kind: 'video', durationMs: null },
    });
  });

  it('accepts a single photo with its size', () => {
    expect(selectSwapMedia([photo()])).toEqual({
      ok: true,
      media: {
        kind: 'photos',
        photos: [{ uri: 'file:///front.jpg', width: 4032, height: 3024 }],
      },
      label: '1 photo selected',
    });
  });

  it('accepts up to six photos and counts them', () => {
    const photos = Array.from({ length: 6 }, (_, i) => photo(`p${i}`));

    expect(selectSwapMedia(photos)).toMatchObject({
      ok: true,
      label: '6 photos selected',
    });
  });

  it('recognises items by MIME type when the picker gives no type', () => {
    const selection = selectSwapMedia([
      { uri: 'file:///a.png', mimeType: 'image/png' },
    ]);

    expect(selection).toMatchObject({
      ok: true,
      media: { kind: 'photos', photos: [{ width: 0, height: 0 }] },
    });
  });

  it('treats livePhoto and pairedVideo assets as photos and videos even without a MIME type', () => {
    expect(
      selectSwapMedia([{ uri: 'file:///live.heic', type: 'livePhoto' }])
    ).toMatchObject({
      ok: true,
      media: { kind: 'photos', photos: [{ uri: 'file:///live.heic' }] },
      label: '1 photo selected',
    });
    expect(
      selectSwapMedia([
        { uri: 'file:///paired.mov', type: 'pairedVideo', duration: 3000 },
      ])
    ).toMatchObject({
      ok: true,
      media: {
        kind: 'video',
        uri: 'file:///paired.mov',
        durationMs: 3000,
      },
      label: 'Video selected',
    });
  });

  it('refuses more than six photos', () => {
    const photos = Array.from({ length: 7 }, (_, i) => photo(`p${i}`));

    expect(selectSwapMedia(photos)).toEqual({
      ok: false,
      error: 'Please choose up to 6 photos.',
    });
  });

  it('refuses a mix of photos and a video', () => {
    expect(selectSwapMedia([photo(), video()])).toEqual({
      ok: false,
      error: 'Please choose either one video or up to 6 photos, not both.',
    });
  });

  it('refuses more than one video', () => {
    expect(selectSwapMedia([video('a'), video('b')])).toEqual({
      ok: false,
      error: 'Please choose just one video.',
    });
  });

  const refused: [string, SwapPickedAsset[]][] = [
    ['nothing', []],
    ['an item that is neither a photo nor a video', [{ uri: 'file:///x.pdf' }]],
  ];

  it.each(refused)('refuses %s', (_label, assets) => {
    expect(selectSwapMedia(assets)).toEqual({
      ok: false,
      error: 'Please choose photos or a video.',
    });
  });
});
