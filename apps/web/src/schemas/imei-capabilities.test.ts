import { describe, expect, it } from 'vitest';
import { imeiCapabilitiesQuerySchema } from './imei-capabilities';

describe('IMEI capability query schema', () => {
  it('defaults omitted capabilities and accepts every supported device', () => {
    expect(imeiCapabilitiesQuerySchema.parse({})).toEqual({
      clientCapabilities: [],
    });
    for (const device of ['smartphone', 'tablet', 'laptop', 'watch']) {
      expect(imeiCapabilitiesQuerySchema.parse({ device }).device).toBe(device);
    }
  });
  it('trims capability values and accepts exact length/count boundaries', () => {
    expect(
      imeiCapabilitiesQuerySchema.parse({
        clientCapabilities: [' imei-async-v1 '],
      })
    ).toEqual({ clientCapabilities: ['imei-async-v1'] });
    const clientCapabilities = Array.from({ length: 10 }, () => 'x'.repeat(64));
    expect(
      imeiCapabilitiesQuerySchema.parse({ clientCapabilities })
        .clientCapabilities
    ).toEqual(clientCapabilities);
    expect(
      imeiCapabilitiesQuerySchema.parse({ clientCapabilities: ['x'] })
        .clientCapabilities
    ).toEqual(['x']);
  });
  it.each([
    { device: 'desktop' },
    { device: ['smartphone', 'tablet'] },
    { clientCapabilities: '' },
    { clientCapabilities: [''] },
    { clientCapabilities: ['   '] },
    { clientCapabilities: [1] },
    { clientCapabilities: ['x'.repeat(65)] },
    { clientCapabilities: Array.from({ length: 11 }, () => 'x') },
    { merchantId: 'unexpected' },
  ])('rejects invalid or unexpected query input %j', (input) => {
    expect(imeiCapabilitiesQuerySchema.safeParse(input).success).toBe(false);
  });
});
