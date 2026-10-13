import { describe, expect, it } from 'vitest';
import { stripUsedDeviceConditionMetadata } from './strip-used-device-condition-metadata';

describe('stripUsedDeviceConditionMetadata', () => {
  it('removes battery-health grading while retaining storage', () => {
    expect(
      stripUsedDeviceConditionMetadata([
        'apple',
        'iphone',
        '13',
        '128gb',
        '85',
        'battery',
        'health',
      ])
    ).toEqual(['apple', 'iphone', '13', '128gb']);
  });

  it('removes letter grades without removing the model', () => {
    expect(
      stripUsedDeviceConditionMetadata([
        'apple',
        'iphone',
        '13',
        'grade',
        'a',
        '128gb',
      ])
    ).toEqual(['apple', 'iphone', '13', '128gb']);
  });
});
