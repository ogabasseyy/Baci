import { describe, expect, it } from 'vitest';

interface SmokeSemanticModule {
  isValidBuilderAiJsonTransportSmokeResult: (output: unknown) => boolean;
}

const smokeModulePath = './builder-ai-json-transport-worker';

function loadSemanticModule(): Promise<SmokeSemanticModule> {
  return import(smokeModulePath) as Promise<SmokeSemanticModule>;
}

const requestedPlan = {
  operations: [
    {
      componentId: 'smoke-hero',
      kind: 'update_component',
      patch: { componentType: 'Hero', title: 'Smoke checked' },
    },
  ],
  status: 'proposed',
  summary: 'Update the smoke hero title',
};

describe('isValidBuilderAiJsonTransportSmokeResult', () => {
  it('accepts only the exact requested title update with no warnings', async () => {
    const { isValidBuilderAiJsonTransportSmokeResult } =
      await loadSemanticModule();

    expect(isValidBuilderAiJsonTransportSmokeResult(requestedPlan)).toBe(true);
  });

  it.each([
    ['a refusal', { operations: [], reason: 'Cannot help', status: 'refused' }],
    ['schema-invalid output', { status: 'proposed' }],
    [
      'a warning-only no-op',
      {
        ...requestedPlan,
        operations: [
          {
            ...requestedPlan.operations[0],
            patch: { componentType: 'Hero', title: 'Smoke' },
          },
        ],
      },
    ],
    [
      'a wrong component target',
      {
        ...requestedPlan,
        operations: [
          { ...requestedPlan.operations[0], componentId: 'different-hero' },
        ],
      },
    ],
    [
      'an unrelated root operation',
      {
        operations: [{ kind: 'update_root', title: 'Smoke checked' }],
        status: 'proposed',
        summary: 'Update the root',
      },
    ],
    [
      'multiple operations',
      {
        ...requestedPlan,
        operations: [
          requestedPlan.operations[0],
          { kind: 'update_root', title: 'Unexpected' },
        ],
      },
    ],
  ])('rejects %s', async (_description, output) => {
    const { isValidBuilderAiJsonTransportSmokeResult } =
      await loadSemanticModule();

    expect(isValidBuilderAiJsonTransportSmokeResult(output)).toBe(false);
  });
});
