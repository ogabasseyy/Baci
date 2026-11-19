import { parsePetrockModelScope } from './petrock-device-model';
import { evaluatePetrockRemediationEligibility } from './petrock-remediation-eligibility';

export interface PetrockOrderEligibilityProduct {
  carrier: string;
  curatedProductId: string;
  modelScope: unknown;
  statusSegment: string;
}

/** Revalidate persisted evidence, never just the assessment's saved status. */
export function isPetrockRemediationOrderEligible(
  evidence: unknown,
  product: PetrockOrderEligibilityProduct
): boolean {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence))
    return false;
  const modelScope = parsePetrockModelScope(product.modelScope);
  if (!modelScope) return false;
  const result = Object.fromEntries(
    Object.entries(evidence).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
  const evaluation = evaluatePetrockRemediationEligibility({
    result,
    products: [
      {
        id: product.curatedProductId,
        carrier: product.carrier,
        modelScope,
        statusSegment: product.statusSegment,
        manualDisabled: false,
      },
    ],
  });
  return (
    evaluation.kind === 'eligible' &&
    evaluation.productIds.includes(product.curatedProductId)
  );
}
