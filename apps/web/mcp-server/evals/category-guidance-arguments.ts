import { mcpDiscoveryIntentSchema } from '../../src/schemas/mcp-discovery-intent';
import { categoryGuidanceCases } from './category-guidance-cases';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Grade emitted arguments independently of transport or product execution. */
export function gradeCategoryGuidanceArguments(caseId: keyof typeof categoryGuidanceCases, emittedInput: unknown) {
  if (!Object.hasOwn(categoryGuidanceCases, caseId)) {
    return { passed: false, failures: ['Unknown evaluation case'] };
  }
  const testCase = categoryGuidanceCases[caseId];
  const input = record(emittedInput);
  const failures: string[] = [];
  if (testCase.category === undefined) {
    if (Object.hasOwn(input, 'category')) {
      failures.push('First emitted arguments must omit category for this natural request');
    }
  } else if (typeof input.category !== 'string' || input.category.trim().toLowerCase() !== testCase.category.toLowerCase()) {
    failures.push('First emitted arguments must preserve the explicitly requested category');
  }
  const parsedIntent = mcpDiscoveryIntentSchema.safeParse(input.intent);
  const alternatives = parsedIntent.success ? parsedIntent.data.alternatives : [];
  if (!Array.isArray(alternatives) || !alternatives.some((value) => {
    const alternative = record(value);
    const model = alternative.model;
    return alternative.product_type === testCase.productType
      && Array.isArray(alternative.brands)
      && alternative.brands.some((brand: unknown) => typeof brand === 'string' && brand.toLowerCase() === testCase.brand.toLowerCase())
      && typeof model === 'string'
      && [testCase.model, ...testCase.modelAliases].flatMap((alias) => [alias, `${testCase.brand} ${alias}`]).some((expectedModel) => model.trim().replace(/\s+/g, ' ').toLowerCase() === expectedModel.toLowerCase());
  })) {
    failures.push('First emitted intent must contain the requested product type, brand and model');
  }
  return { passed: failures.length === 0, failures };
}
