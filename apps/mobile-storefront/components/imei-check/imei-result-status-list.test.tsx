import { describe, expect, it } from '@jest/globals';
import { imeiStatusTone } from './imei-result-status-list';

describe('imeiStatusTone', () => {
  it('bugfix: reads "Not Blacklisted" as clean, not as a failure', () => {
    expect(
      imeiStatusTone({
        blacklist: true,
        cleanAware: true,
        value: 'Not Blacklisted',
      })
    ).toBe('safe');
    expect(
      imeiStatusTone({
        blacklist: true,
        cleanAware: true,
        value: 'Blacklisted',
      })
    ).toBe('danger');
    expect(
      imeiStatusTone({ blacklist: true, cleanAware: true, value: 'Unknown' })
    ).toBe('caution');
  });

  it('colours other pass/fail findings by whether they are clean', () => {
    expect(imeiStatusTone({ cleanAware: true, value: 'Off' })).toBe('safe');
    expect(imeiStatusTone({ cleanAware: true, value: 'On' })).toBe('danger');
    expect(imeiStatusTone({ cleanAware: true, value: 'unknown' })).toBe(
      'caution'
    );
  });

  it('keeps facts such as warranty neutral', () => {
    expect(imeiStatusTone({ value: 'Out Of Warranty' })).toBe('neutral');
    expect(imeiStatusTone({ value: 'Limited Warranty' })).toBe('neutral');
  });
});
