import { describe, expect, it } from 'vitest';
import { getEligibleConditionOffers } from './eligible-condition-offers';
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

  it('prefers exact spellings when requested, feed order otherwise', () => {
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
    // Without the exact preference the canonical fallback still lands
    // on the open_box row: raw condition sorts before id (feed
    // order), so the higher id does not lose to the refurbished
    // alias. Input order must not decide.
    expect(
      selectConditionOffer(candidates, { selectedCondition: 'open_box' })
    ).toEqual(exact);
    expect(
      selectConditionOffer([exact, offers[1], offers[0]], {
        selectedCondition: 'open_box',
      })
    ).toEqual(exact);
  });

  it('returns null for a supplied-but-unnormalizable condition even with a single offer', () => {
    const [only] = offers;
    expect(
      selectConditionOffer([only], { selectedCondition: 'stale-spelling-xyz' })
    ).toBeNull();
    expect(
      selectConditionOffer([only], {
        selectedCondition: 'stale-spelling-xyz',
        preferExactConditionMatch: true,
      })
    ).toBeNull();
    // No selection at all still resolves the single offer.
    expect(selectConditionOffer([only], {})?.id).toBe(only.id);
    expect(selectConditionOffer([only], { selectedCondition: null })?.id).toBe(
      only.id
    );
  });

  it('agrees with the feed dedup on the first row per canonical condition', () => {
    const candidates = [
      { id: 'offer-aaa-refurbished', condition: 'refurbished', price: 510 },
      { id: 'offer-zzz-open-box', condition: 'open_box', price: 525 },
    ];
    const [kept] = getEligibleConditionOffers(candidates, 'new');
    expect(kept?.id).toBe('offer-zzz-open-box');
    expect(
      selectConditionOffer(candidates, { selectedCondition: 'open_box' })?.id
    ).toBe(kept?.id);
    expect(
      selectConditionOffer([candidates[1], candidates[0]], {
        selectedCondition: 'open_box',
      })?.id
    ).toBe(kept?.id);
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
