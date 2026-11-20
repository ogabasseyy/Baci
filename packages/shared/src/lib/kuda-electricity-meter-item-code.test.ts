import { describe, expect, it } from 'vitest';
import { isKudaElectricityMeterItemCode } from './kuda-electricity-meter-item-code';

describe('isKudaElectricityMeterItemCode', () => {
  it('recognises the listed meter products in any case', () => {
    expect(isKudaElectricityMeterItemCode('KUD-ELE-EKED-002')).toBe(true);
    expect(isKudaElectricityMeterItemCode(' kud-ele-aedc-001 ')).toBe(true);
  });

  it('rejects codes that are not listed meter products', () => {
    expect(isKudaElectricityMeterItemCode('KUD-ELE-NEW-FIXED')).toBe(false);
    expect(isKudaElectricityMeterItemCode('KUD-CAB-STT-SUPER')).toBe(false);
  });
});
