import { createHash } from 'node:crypto';
import { resolveSavingsDeviceSelection } from '@/lib/customer-savings-device';
import { customerSavingsDraftSchemas } from '@/schemas/customer-savings-draft';

export function customerSavingsDraftView(input: unknown) {
  const record = customerSavingsDraftSchemas.record.parse(input);
  const device = resolveSavingsDeviceSelection({
    product: record.catalogue,
    variantId: record.variantId,
  });
  if (
    !device.ok ||
    record.catalogue.id !== record.productId ||
    !device.snapshot.condition?.trim() ||
    createHash('sha256').update(record.terms.text, 'utf8').digest('hex') !==
      record.terms.hash ||
    (record.acceptedAt !== null &&
      Date.parse(record.acceptedAt) < Date.parse(record.createdAt))
  ) {
    throw new Error('Draft unavailable');
  }
  return {
    draftId: record.draftId,
    requestId: record.requestId,
    revisionId: record.revisionId,
    productId: record.productId,
    variantId: record.variantId,
    status: 'draft' as const,
    device: { ...device.snapshot, condition: device.snapshot.condition },
    terms: record.terms,
    consent:
      record.acceptedAt === null
        ? ('required' as const)
        : ('accepted' as const),
    createdAt: record.createdAt,
    acceptedAt: record.acceptedAt,
  };
}
