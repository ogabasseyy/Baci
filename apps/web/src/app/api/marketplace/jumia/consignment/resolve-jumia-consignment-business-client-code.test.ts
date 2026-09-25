import { describe, expect, it } from 'vitest';
import { resolveJumiaConsignmentBusinessClientCode } from './resolve-jumia-consignment-business-client-code';

describe('resolveJumiaConsignmentBusinessClientCode', () => {
  it('uses the selected marketplace key for self-authorized integrations', () => {
    expect(
      resolveJumiaConsignmentBusinessClientCode(' NG-RETAIL ', 'NG-RETAIL')
    ).toEqual({ ok: true, businessClientCode: 'NG-RETAIL' });
  });

  it('rejects a request that targets another marketplace', () => {
    expect(
      resolveJumiaConsignmentBusinessClientCode('NG-RETAIL', 'GH-RETAIL')
    ).toEqual({ ok: false });
  });

  it('preserves the requested code for legacy OAuth fallbacks', () => {
    expect(
      resolveJumiaConsignmentBusinessClientCode('oauth', ' NG-RETAIL ')
    ).toEqual({ ok: true, businessClientCode: 'NG-RETAIL' });
  });
});
