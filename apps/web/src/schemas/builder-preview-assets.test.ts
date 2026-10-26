import { expect, it } from 'vitest';
import {
  hasSafeBuilderPreviewAssets,
  isBuilderPreviewAsset,
} from './builder-preview-assets';

it('accepts public checked assets but rejects signed/private/credential and foreign URLs', () => {
  expect(
    isBuilderPreviewAsset(
      'https://example.supabase.co/storage/v1/object/public/images/logo.png'
    )
  ).toBe(true);
  for (const value of [
    'https://example.supabase.co/storage/v1/object/sign/private/logo.png',
    'https://usebaci.com/logo.png?token=SECRET',
    'https://user:secret@usebaci.com/logo.png',
    'https://evil.example/logo.png',
    'http://127.0.0.1/logo',
  ])
    expect(isBuilderPreviewAsset(value)).toBe(false);
});
it('keeps safe theme colors and lengths while refusing CSS network loaders and escapes', () => {
  expect(
    hasSafeBuilderPreviewAssets({
      theme: {
        colors: { background: 'hsl(240 10% 20% / 0.5)' },
        spacing: { large: 'calc(10px + 2vw)' },
      },
    })
  ).toBe(true);
  for (const background of [
    'url(/secret)',
    'URL (https://usebaci.com/logo.png)',
    'image-set("/secret" 1x)',
    String.raw`u\72l(/secret)`,
    'u/**/rl(/secret)',
    'var(--untrusted)',
  ])
    expect(
      hasSafeBuilderPreviewAssets({ theme: { colors: { background } } })
    ).toBe(false);
});
