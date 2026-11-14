import type { BuilderAiEditPlan } from '@baci/shared/contracts';
import { builderAiEditTestFixture } from '@baci/shared/test-fixtures/builder-ai-edit';
import { expect, it } from 'vitest';
import {
  isSemanticallyExecutable,
  parseRequest,
} from './builder-ai-edit-input';

const { request } = builderAiEditTestFixture;
const legacy = {
  currentConfig: request.currentConfig,
  merchantId: request.merchantId,
  prompt: request.prompt,
};

it('preserves the v1 request and assigns a v1 identity to legacy input', () => {
  expect(parseRequest(request, 'v1')).toEqual(request);
  expect(parseRequest(legacy, 'legacy')).toEqual({
    ...legacy,
    clientRequestId: expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    ),
    contractVersion: request.contractVersion,
  });
});

it('rejects the wrong envelope for either mode and validates legacy fields', () => {
  expect(parseRequest(legacy, 'v1')).toBeNull();
  expect(parseRequest(request, 'legacy')).toBeNull();
  expect(parseRequest({ ...legacy, prompt: ' ' }, 'legacy')).toBeNull();
});

it('accepts applicable edits and refusals and rejects edits targeting missing components', () => {
  const parsed = parseRequest(request, 'v1');
  if (!parsed) throw Error('Invalid synthetic request');
  const plan = {
    status: 'proposed',
    summary: 'Rename the hero',
    operations: [
      {
        kind: 'update_component',
        componentId: 'hero-1',
        patch: { componentType: 'Hero', title: 'A new title' },
      },
    ],
  } satisfies BuilderAiEditPlan;
  expect(isSemanticallyExecutable(plan, parsed)).toBe(true);
  expect(
    isSemanticallyExecutable(
      { status: 'refused', reason: 'Unsupported edit', operations: [] },
      parsed
    )
  ).toBe(true);
  expect(
    isSemanticallyExecutable(
      {
        ...plan,
        operations: [{ ...plan.operations[0], componentId: 'missing' }],
      },
      parsed
    )
  ).toBe(false);
});
