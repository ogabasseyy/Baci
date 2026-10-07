import { describe, expect, it } from 'vitest';
import { savingsDraftFixture } from './customer-savings-draft.test-fixture';
import { customerSavingsDraftView } from './customer-savings-draft-view';

describe('customerSavingsDraftView', () => {
  it('uses existing exact-variant pricing and exposes no financial state', () => {
    const { record } = savingsDraftFixture();
    const view = customerSavingsDraftView(record);
    expect(view.device).toMatchObject({
      price: 125,
      condition: 'used',
      variantLabel: 'Storage: 256GB',
      selectionStatus: 'exact',
    });
    expect(view).toMatchObject({
      status: 'draft',
      consent: 'required',
      acceptedAt: null,
    });
    for (const field of [
      'balance',
      'schedule',
      'goalId',
      'funding',
      'guarantee',
    ])
      expect(view).not.toHaveProperty(field);
  });
  it('records acceptance without promoting the draft', () => {
    const { record } = savingsDraftFixture();
    expect(
      customerSavingsDraftView({
        ...record,
        acceptedAt: '2026-09-13T12:01:00Z',
      })
    ).toMatchObject({ status: 'draft', consent: 'accepted' });
  });
  it.each([
    'variant',
    'product',
    'terms',
    'time',
    'condition',
  ])('fails closed for invalid stored %s', (field) => {
    const { record } = savingsDraftFixture();
    if (field === 'variant') record.variantId = record.draftId;
    if (field === 'product') record.productId = record.draftId;
    if (field === 'terms') record.terms.text += ' changed';
    if (field === 'time') record.acceptedAt = '2026-09-12T12:01:00Z';
    if (field === 'condition') record.catalogue.variants[0].condition = '';
    expect(() => customerSavingsDraftView(record)).toThrow();
  });
});
