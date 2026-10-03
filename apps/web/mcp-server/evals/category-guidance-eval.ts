export const categoryGuidanceCases = {
  camera: {
    prompt: 'Find the Xiaomi Smart Camera C300 and show its photo and current listed price. Do not add it to cart.',
    productType: 'security_camera',
    model: 'C300',
    brand: 'Xiaomi',
    category: undefined,
  },
  tecno: {
    prompt: 'Show the Tecno Spark 50 photo and current listed price. Do not add it to cart.',
    productType: 'phone',
    model: 'Spark 50',
    brand: 'Tecno',
    category: undefined,
  },
  explicitCategory: {
    prompt: 'Find the Xiaomi Smart Camera C300 in the Cameras catalog category. Show its photo and current listed price. Do not add it to cart.',
    productType: 'security_camera',
    model: 'C300',
    brand: 'Xiaomi',
    category: 'Cameras',
  },
} as const;

type CaseId = keyof typeof categoryGuidanceCases;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Grade the FIRST real widget call, including failures before a successful retry. */
export function gradeCategoryGuidance(caseId: CaseId, capturedTraces: unknown) {
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
  if (testCase.category === undefined) {
    if (Object.hasOwn(input, 'category')) {
      failures.push('First emitted arguments must omit category for this natural request');
    }
  } else if (input.category !== testCase.category) {
    failures.push('First emitted arguments must preserve the explicitly requested category');
  }
  const alternatives = record(input.intent).alternatives;
  if (!Array.isArray(alternatives) || !alternatives.some((value) => {
    const alternative = record(value);
    return alternative.product_type === testCase.productType
      && Array.isArray(alternative.brands)
      && alternative.brands.some((brand: unknown) => typeof brand === 'string' && brand.toLowerCase() === testCase.brand.toLowerCase())
      && typeof alternative.model === 'string'
      && alternative.model.toLowerCase().includes(testCase.model.toLowerCase());
  })) {
    failures.push('First emitted intent must contain the requested product type, brand and model');
  }
  if (output.status !== 'success' || !Array.isArray(output.products) || output.products.length === 0) {
    failures.push('First call must return products successfully; a later retry does not pass');
  }
  return { passed: failures.length === 0, failures };
}
