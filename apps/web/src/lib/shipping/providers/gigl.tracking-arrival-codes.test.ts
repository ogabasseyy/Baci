import { describe, expect, it } from 'vitest';
import {
  DEPARTURE_CODES,
  DEPARTURE_WORD,
  EXPLICIT_ARRIVAL_CODES,
  FOREIGN_OFFICE_DESTINATIONS,
  RETURN_CODES,
  RETURN_FLOW_CODES,
} from './gigl.tracking-arrival-codes';

describe('GIG arrival code sets', () => {
  it('classifies explicit arrival codes and keeps them apart from departures and returns', () => {
    for (const code of ['ARF', 'MAFD', 'AHD', 'ADF', 'AD', 'DUBC']) {
      expect(EXPLICIT_ARRIVAL_CODES.has(code)).toBe(true);
      expect(DEPARTURE_CODES.has(code)).toBe(false);
      expect(RETURN_FLOW_CODES.has(code)).toBe(false);
    }
  });

  it('keeps return-flow codes a subset of the codes that block arrival inference except MRTD', () => {
    for (const code of RETURN_FLOW_CODES) {
      expect(RETURN_CODES.has(code) || code === 'SRHUB').toBe(true);
    }
    expect(RETURN_CODES.has('MRTD')).toBe(true);
    expect(RETURN_FLOW_CODES.has('MRTD')).toBe(false);
  });

  it('treats departure codes as non-arrivals', () => {
    for (const code of ['DSC', 'DPC', 'MDSE', 'IDK']) {
      expect(DEPARTURE_CODES.has(code)).toBe(true);
      expect(EXPLICIT_ARRIVAL_CODES.has(code)).toBe(false);
    }
  });

  it('matches foreign-office arrivals only for their own destination country', () => {
    expect(FOREIGN_OFFICE_DESTINATIONS.ARFK?.test('LONDON')).toBe(true);
    expect(FOREIGN_OFFICE_DESTINATIONS.ARFK?.test('ABUJA')).toBe(false);
    expect(FOREIGN_OFFICE_DESTINATIONS.ARUS?.test('HOUSTON')).toBe(true);
    expect(FOREIGN_OFFICE_DESTINATIONS.ARUS?.test('LONDON')).toBe(false);
  });

  it('matches departure wording as whole words only', () => {
    expect(DEPARTURE_WORD.test('SHIPMENT DEPARTED SERVICE CENTRE')).toBe(true);
    expect(DEPARTURE_WORD.test('DEPARTS')).toBe(true);
    expect(DEPARTURE_WORD.test('DEPARTMENT STORE')).toBe(false);
  });
});
