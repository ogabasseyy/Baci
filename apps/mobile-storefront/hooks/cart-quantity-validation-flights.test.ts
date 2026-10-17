import {
  advanceQuantityValidationBaseline,
  beginQuantityValidationFlight,
  endQuantityValidationFlight,
  readQuantityValidationBaseline,
} from './cart-quantity-validation-flights';

describe('quantity validation flights', () => {
  it('starts a flight with the pre-write quantity as baseline', () => {
    beginQuantityValidationFlight('line-a', 2);
    expect(readQuantityValidationBaseline('line-a')).toBe(2);
    endQuantityValidationFlight('line-a');
  });

  it('keeps the first baseline when flights overlap', () => {
    beginQuantityValidationFlight('line-b', 2);
    beginQuantityValidationFlight('line-b', 5);
    expect(readQuantityValidationBaseline('line-b')).toBe(2);
    endQuantityValidationFlight('line-b');
    endQuantityValidationFlight('line-b');
  });

  it('advances the baseline only on validated success', () => {
    beginQuantityValidationFlight('line-c', 2);
    advanceQuantityValidationBaseline('line-c', 4);
    expect(readQuantityValidationBaseline('line-c')).toBe(4);
    endQuantityValidationFlight('line-c');
  });

  it('clears the flight when the last pending validation ends', () => {
    beginQuantityValidationFlight('line-d', 2);
    beginQuantityValidationFlight('line-d', 3);
    endQuantityValidationFlight('line-d');
    expect(readQuantityValidationBaseline('line-d')).toBe(2);
    endQuantityValidationFlight('line-d');
    expect(readQuantityValidationBaseline('line-d')).toBeUndefined();
  });

  it('ignores end and advance calls for unknown lines', () => {
    expect(() => endQuantityValidationFlight('line-missing')).not.toThrow();
    expect(() =>
      advanceQuantityValidationBaseline('line-missing', 9)
    ).not.toThrow();
    expect(readQuantityValidationBaseline('line-missing')).toBeUndefined();
  });

  it('restarts cleanly after the previous flight completed', () => {
    beginQuantityValidationFlight('line-e', 1);
    endQuantityValidationFlight('line-e');
    beginQuantityValidationFlight('line-e', 6);
    expect(readQuantityValidationBaseline('line-e')).toBe(6);
    endQuantityValidationFlight('line-e');
  });
});
