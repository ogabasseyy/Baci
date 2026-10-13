import { describe, expect, it } from 'vitest';
import { isComputerExcludedSpecKey } from './is-computer-excluded-spec-key';

describe('isComputerExcludedSpecKey', () => {
  it('rejects stale camera fields without rejecting optional laptop radios', () => {
    expect(isComputerExcludedSpecKey('main_camera_mp')).toBe(true);
    expect(isComputerExcludedSpecKey('android_version')).toBe(true);
    expect(isComputerExcludedSpecKey('has_5g')).toBe(false);
    expect(isComputerExcludedSpecKey('has_nfc')).toBe(false);
    expect(isComputerExcludedSpecKey('sim_type')).toBe(false);
  });
});
