import { expect, it } from 'vitest';
import {
  amendmentPreviewResult,
  amendmentReplacementSearchSchema,
  workspaceSchema,
} from './order-amendment';

it('rejects an invalid catalog query and trims an accepted query', () => {
  const lineId = '11111111-1111-4111-8111-111111111111';
  expect(
    amendmentReplacementSearchSchema.parse({ lineId, search: ' phone ' })
  ).toEqual({
    lineId,
    search: 'phone',
  });
  expect(
    amendmentReplacementSearchSchema.safeParse({ lineId, search: ' p ' })
      .success
  ).toBe(false);
});

it('retains an empty unamended workspace and rejects an invalid quote', () => {
  const workspace = {
    canStart: true,
    canEdit: true,
    canRefund: false,
    confirmationKey: null,
    summary: null,
    customer: null,
    events: [],
    refunds: [],
    bankEvidence: [],
  };
  expect(workspaceSchema.parse(workspace)).toEqual(workspace);
  expect(
    amendmentPreviewResult.safeParse({ adjustmentMinor: '5000' }).success
  ).toBe(false);
});
