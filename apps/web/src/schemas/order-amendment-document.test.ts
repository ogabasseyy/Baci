import { describe, expect, it } from 'vitest';
import {
  amendmentUpdateEventIdsSchema,
  paidOrderDocumentProjectionSchema,
  paidOrderDocumentVersionSchema,
} from './order-amendment-document';

describe('paid-order document schemas', () => {
  it('preserves nullable monetary fields on ordinary order documents', () => {
    const projection = {
      inputs: {
        order: { total: 480, subtotal: null, amount_paid: null },
        items: [],
      },
      amendment: null,
      documentNumber: null,
    };
    expect(paidOrderDocumentProjectionSchema.parse(projection)).toEqual(
      projection
    );
    expect(
      paidOrderDocumentProjectionSchema.safeParse({
        ...projection,
        inputs: {
          ...projection.inputs,
          order: { ...projection.inputs.order, total: null },
        },
      }).success
    ).toBe(false);
  });

  it('distinguishes historical version selectors from an internal live read', () => {
    expect(paidOrderDocumentVersionSchema.parse('original')).toBe('original');
    expect(paidOrderDocumentVersionSchema.parse('current')).toBe('current');
    expect(paidOrderDocumentVersionSchema.safeParse('live').success).toBe(
      false
    );
  });

  it('keeps update event IDs as lossless decimal strings', () => {
    const id = '9007199254740993';
    expect(amendmentUpdateEventIdsSchema.parse([id])).toEqual([id]);
    expect(amendmentUpdateEventIdsSchema.safeParse([Number(id)]).success).toBe(
      false
    );
  });
});
