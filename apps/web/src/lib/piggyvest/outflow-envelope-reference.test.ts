import { describe, expect, it } from 'vitest';
import { withEnvelopeReference } from './outflow-envelope-reference';

describe('withEnvelopeReference', () => {
  it('adds the envelope pvb_third_party_reference after the eventData candidates', () => {
    expect(
      withEnvelopeReference(['PVB01X'], {
        pvb_third_party_reference: 'pvb-pay-1',
      })
    ).toEqual(['PVB01X', 'pvb-pay-1']);
  });

  it('adds nothing when the envelope has no usable reference or repeats one', () => {
    expect(withEnvelopeReference(['a'], {})).toEqual(['a']);
    expect(
      withEnvelopeReference(['a'], { pvb_third_party_reference: '' })
    ).toEqual(['a']);
    expect(
      withEnvelopeReference(['a'], { pvb_third_party_reference: 7 })
    ).toEqual(['a']);
    expect(
      withEnvelopeReference(['a'], { pvb_third_party_reference: 'a' })
    ).toEqual(['a']);
    expect(withEnvelopeReference(['a'], null)).toEqual(['a']);
  });
});
