import { describe, expect, it } from 'vitest';
import { deviceChangeSchemas } from './device-change';

describe('deviceChangeSchemas', () => {
  it('exposes quote and receipt row wrappers', () => {
    expect(typeof deviceChangeSchemas.quoteRows.parse).toBe('function');
    expect(typeof deviceChangeSchemas.receiptRows.parse).toBe('function');
  });

  it('requires exactly one quote row', () => {
    expect(deviceChangeSchemas.quoteRows.safeParse([]).success).toBe(false);
    expect(
      deviceChangeSchemas.quoteRows.safeParse([{ result: null }]).success
    ).toBe(false);
  });

  it('requires exactly one receipt row', () => {
    expect(deviceChangeSchemas.receiptRows.safeParse([]).success).toBe(false);
    expect(
      deviceChangeSchemas.receiptRows.safeParse([{ result: null }]).success
    ).toBe(false);
  });
});
