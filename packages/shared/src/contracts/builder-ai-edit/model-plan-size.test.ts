import { describe, expect, it } from 'vitest';
import {
  builderAiModelPlanSchema,
  MAX_AI_PLAN_SERIALIZED_UTF8_BYTES,
} from './index';

function heroPlan(subtitle: string) {
  return {
    operations: [
      {
        componentId: 'hero-1',
        kind: 'update_component',
        patch: { componentType: 'Hero', subtitle },
      },
    ],
    status: 'proposed',
    summary: 'Update hero copy',
  };
}

function planAtUtf8Size(byteLength: number) {
  for (let length = 1; length <= 2_000; length++) {
    const plan = {
      ...heroPlan('x'.repeat(2_000)),
      operations: [
        ...heroPlan('x'.repeat(2_000)).operations,
        {
          componentId: 'hero-2',
          kind: 'update_component',
          patch: { componentType: 'Hero', subtitle: 'x'.repeat(length) },
        },
      ],
    };
    if (
      new TextEncoder().encode(JSON.stringify(plan)).byteLength === byteLength
    )
      return plan;
  }
  throw new Error(`Could not construct a ${byteLength}-byte valid plan`);
}

describe('builder AI model plan aggregate UTF-8 limit', () => {
  it('accepts exactly 20 concise root-title operations within the aggregate cap', () => {
    const plan = {
      operations: Array.from({ length: 20 }, (_, index) => ({
        kind: 'update_root',
        title: `Title ${index + 1}`,
      })),
      status: 'proposed',
      summary: 'Apply concise page-title updates',
    };

    expect(
      new TextEncoder().encode(JSON.stringify(plan)).byteLength
    ).toBeLessThanOrEqual(MAX_AI_PLAN_SERIALIZED_UTF8_BYTES);
    expect(builderAiModelPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('accepts a structurally valid plan at exactly 4,096 UTF-8 bytes', () => {
    const plan = planAtUtf8Size(MAX_AI_PLAN_SERIALIZED_UTF8_BYTES);

    expect(new TextEncoder().encode(JSON.stringify(plan)).byteLength).toBe(
      MAX_AI_PLAN_SERIALIZED_UTF8_BYTES
    );
    expect(builderAiModelPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('rejects a structurally valid plan at 4,097 UTF-8 bytes', () => {
    const plan = planAtUtf8Size(MAX_AI_PLAN_SERIALIZED_UTF8_BYTES + 1);

    expect(builderAiModelPlanSchema.safeParse(plan).success).toBe(false);
  });

  it('counts UTF-8 bytes instead of JavaScript string length', () => {
    const plan = heroPlan('é'.repeat(2_000));
    const serialized = JSON.stringify(plan);

    expect(serialized.length).toBeLessThan(MAX_AI_PLAN_SERIALIZED_UTF8_BYTES);
    expect(new TextEncoder().encode(serialized).byteLength).toBeGreaterThan(
      MAX_AI_PLAN_SERIALIZED_UTF8_BYTES
    );
    expect(builderAiModelPlanSchema.safeParse(plan).success).toBe(false);
  });
});
