import { describe, expect, it } from 'vitest';
import { selectConditionOffer } from './select-condition-offer';

describe('selectConditionOffer', () => {
  const offers = [
    { id: 'offer-refurbished', condition: 'refurbished', price: 510 },
    { id: 'offer-uk-used', condition: 'uk_used', price: 495 },
  ];

  it('matches canonical selections against legacy aliases', () => {
    expect(
      selectConditionOffer(offers, { selectedCondition: 'open_box' })
    ).toEqual(offers[0]);
    expect(selectConditionOffer(offers, { selectedCondition: 'used' })).toEqual(
      offers[1]
    );
  });

  it('prefers exact spellings only when requested', () => {
    const exact = {
      id: 'offer-zzz-open-box',
      condition: 'open_box',
      price: 525,
    };
    const candidates = [...offers, exact];
    expect(
      selectConditionOffer(candidates, {
        selectedCondition: 'open_box',
        preferExactConditionMatch: true,
      })
    ).toEqual(exact);
    expect(
      selectConditionOffer(candidates, { selectedCondition: 'open_box' })
    ).toEqual(offers[0]);
  });

  it('tiebreaks same-condition fallbacks by lowest offer id', () => {
    const low = { id: 'offer-aaa-used', condition: 'used', price: 500 };
    const high = { id: 'offer-zzz-used', condition: 'used', price: 480 };
    // Input order must not decide: both orders resolve the same row.
    expect(
      selectConditionOffer([high, low], { selectedCondition: 'used' })
    ).toEqual(low);
    expect(
      selectConditionOffer([low, high], { selectedCondition: 'used' })
    ).toEqual(low);
  });

  it('tiebreaks exact-spelling fallbacks by lowest offer id', () => {
    const low = { id: 'offer-aaa-open-box', condition: 'open_box', price: 1 };
    const high = { id: 'offer-zzz-open-box', condition: 'open_box', price: 2 };
    expect(
      selectConditionOffer([high, low], {
        selectedCondition: 'open_box',
        preferExactConditionMatch: true,
      })
    ).toEqual(low);
    expect(
      selectConditionOffer([low, high], {
        selectedCondition: 'open_box',
        preferExactConditionMatch: true,
      })
    ).toEqual(low);
  });

  it('falls back to a single offer when no condition is selected', () => {
    const single = [offers[0]];
    expect(selectConditionOffer(single, {})).toEqual(single[0]);
    expect(selectConditionOffer(offers, {})).toBeNull();
  });

  it('suppresses the match for base-row entries', () => {
    expect(
      selectConditionOffer(offers, {
        selectedCondition: 'used',
        suppressMatch: true,
      })
    ).toBeNull();
    expect(
      selectConditionOffer(offers, {
        selectedCondition: 'used',
        preferredOfferId: 'offer-uk-used',
        suppressMatch: true,
      })
    ).toBeNull();
  });

  it('returns null when offers are missing or empty', () => {
    expect(
      selectConditionOffer(null, { selectedCondition: 'used' })
    ).toBeNull();
    expect(
      selectConditionOffer(undefined, { selectedCondition: 'used' })
    ).toBeNull();
    expect(selectConditionOffer([], { selectedCondition: 'used' })).toBeNull();
  });

  it('honors a preferred id matching the selected condition', () => {
    const cheaper = { id: 'offer-used-cheaper', condition: 'used', price: 480 };
    const candidates = [...offers, cheaper];
    expect(
      selectConditionOffer(candidates, {
        selectedCondition: 'used',
        preferredOfferId: 'offer-used-cheaper',
      })
    ).toEqual(cheaper);
  });

  it('falls through to condition matching for foreign or unknown ids', () => {
    expect(
      selectConditionOffer(offers, {
        selectedCondition: 'used',
        preferredOfferId: 'offer-refurbished',
      })
    ).toEqual(offers[1]);
    expect(
      selectConditionOffer(offers, {
        selectedCondition: 'open_box',
        preferredOfferId: 'offer-unknown',
      })
    ).toEqual(offers[0]);
  });

  it('keeps same-condition selections on the parent family', () => {
    expect(
      selectConditionOffer(offers, {
        selectedCondition: 'used',
        parentCondition: 'uk_used',
      })
    ).toBeNull();
    expect(
      selectConditionOffer(offers, {
        selectedCondition: 'used',
        parentCondition: null,
      })
    ).toEqual(offers[1]);
  });

  it('still honors an explicit pick on the parent condition', () => {
    expect(
      selectConditionOffer(offers, {
        selectedCondition: 'used',
        preferredOfferId: 'offer-uk-used',
        parentCondition: 'used',
      })
    ).toEqual(offers[1]);
  });

  it('tries ordered advertised ids before the condition fallback', () => {
    const cheaper = { id: 'offer-used-cheaper', condition: 'used', price: 480 };
    const candidates = [...offers, cheaper];
    // A mismatched first id falls through to the next, not the find.
    expect(
      selectConditionOffer(candidates, {
        selectedCondition: 'used',
        preferredOfferIds: ['offer-refurbished', 'offer-used-cheaper'],
      })
    ).toEqual(cheaper);
  });
});
