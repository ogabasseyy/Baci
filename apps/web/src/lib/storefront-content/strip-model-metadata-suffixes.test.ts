import { describe, expect, it } from 'vitest';
import { stripModelMetadataSuffixes } from './strip-model-metadata-suffixes';

describe('stripModelMetadataSuffixes', () => {
  it('normalizes ordinal generations with a terminal Type-C connector', () => {
    expect(
      stripModelMetadataSuffixes(['airpods', 'pro', '2nd', 'gen', 'type', 'c'])
    ).toEqual(['airpods', 'pro', '2']);
  });

  it('removes split capacity metadata', () => {
    expect(stripModelMetadataSuffixes(['iphone', '15', '128', 'gb'])).toEqual([
      'iphone',
      '15',
    ]);
  });

  it('removes AirPods charging-case metadata after normalizing its generation', () => {
    expect(
      stripModelMetadataSuffixes([
        'airpods',
        'pro',
        '2nd',
        'generation',
        'with',
        'magsafe',
        'case',
        'usb',
        'c',
      ])
    ).toEqual(['airpods', 'pro', '2']);
  });
});
