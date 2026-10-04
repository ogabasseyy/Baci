import { gradeCategoryGuidanceArguments } from './category-guidance-arguments';
import { categoryGuidanceCases } from './category-guidance-cases';

type CaseId = keyof typeof categoryGuidanceCases;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Grade the FIRST real widget call, including failures before a successful retry. */
export function gradeCategoryGuidance(caseId: CaseId, capturedTraces: unknown) {
  if (!Object.hasOwn(categoryGuidanceCases, caseId)) {
    return { passed: false, failures: ['Unknown evaluation case'] };
  }
  const testCase = categoryGuidanceCases[caseId];
  const failures: string[] = [];
  if (!Array.isArray(capturedTraces) || capturedTraces.length === 0) {
    return { passed: false, failures: ['Missing first-call browser evidence'] };
  }
  let firstCall: Record<string, unknown>;
  try {
    const result = record(record(capturedTraces[0]).result);
    if (result.type !== 'string' || typeof result.value !== 'string') {
      throw new Error('Missing CDP Runtime.evaluate value');
    }
    firstCall = record(JSON.parse(result.value));
  } catch {
    return { passed: false, failures: ['Malformed first-call browser evidence'] };
  }
  const input = record(firstCall.toolInput);
  const output = record(firstCall.toolOutput);
  const failuresFromArguments = gradeCategoryGuidanceArguments(caseId, input);
  failures.push(...failuresFromArguments.failures);
  if (output.status !== 'success' || !Array.isArray(output.products) || output.products.length === 0) {
    failures.push('First call must return products successfully; a later retry does not pass');
  }
  if (Array.isArray(output.products) && !output.products.some((product) => record(product).id === testCase.productId)) {
    failures.push('First returned products must include the requested catalog product identity');
  }
  return { passed: failures.length === 0, failures };
}
