import { describe, expect, it } from 'vitest';
import { stripTrailingWirelessAudioDescriptor } from './strip-trailing-wireless-audio-descriptor';

describe('stripTrailingWirelessAudioDescriptor', () => {
  it('removes a trailing wireless noise-cancelling headphone description', () => {
    expect(
      stripTrailingWirelessAudioDescriptor([
        'wh',
        '1000xm5',
        'wireless',
        'noise',
        'cancelling',
        'headphones',
      ])
    ).toEqual(['wh', '1000xm5']);
  });

  it('preserves wireless when later tokens identify the product', () => {
    expect(
      stripTrailingWirelessAudioDescriptor(['xbox', 'wireless', 'controller'])
    ).toEqual(['xbox', 'wireless', 'controller']);
  });

  it.each([
    'true',
    'truly',
  ])('removes a trailing %s wireless audio description as one phrase', (qualifier) => {
    expect(
      stripTrailingWirelessAudioDescriptor([
        'wf',
        '1000xm5',
        qualifier,
        'wireless',
        'earbuds',
      ])
    ).toEqual(['wf', '1000xm5']);
  });
});
