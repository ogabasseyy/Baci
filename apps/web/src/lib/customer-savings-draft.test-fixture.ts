import { createHash } from 'node:crypto';

export function savingsDraftFixture() {
  const merchantId = '10000000-0000-4000-8000-000000000001';
  const terms = 'Local test document. No financial eligibility is asserted.';
  const record = {
    draftId: '20000000-0000-4000-8000-000000000001',
    requestId: '30000000-0000-4000-8000-000000000001',
    revisionId: '40000000-0000-4000-8000-000000000001',
    productId: '50000000-0000-4000-8000-000000000001',
    variantId: '60000000-0000-4000-8000-000000000001',
    catalogue: {
      id: '50000000-0000-4000-8000-000000000001',
      name: 'Local test device',
      price: '100',
      images: [],
      condition: 'new',
      variants: [
        {
          id: '60000000-0000-4000-8000-000000000001',
          price_override: '125',
          attributes: { storage: '256GB' },
          condition: 'used',
        },
      ],
    },
    createdAt: '2026-09-13T12:00:00Z',
    acceptedAt: null as string | null,
    terms: {
      version: 'local-draft-test-v1',
      hash: createHash('sha256').update(terms).digest('hex'),
      text: terms,
    },
  };
  return {
    merchantId,
    record,
    create: {
      merchantId,
      productId: record.productId,
      variantId: record.variantId,
      requestId: record.requestId,
    },
    accept: {
      merchantId,
      draftId: record.draftId,
      revisionId: record.revisionId,
      termsVersion: record.terms.version,
      termsHash: record.terms.hash,
      accepted: true,
    },
  };
}
