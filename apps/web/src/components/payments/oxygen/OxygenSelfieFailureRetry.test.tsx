import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { OxygenWorkflowError } from './OxygenWorkflowError';

const snapshot = {
  workflowId: '60000000-0000-4000-8000-000000000001',
  version: 2,
  stage: 'kyc_required',
  executionEnabled: true,
  state: {
    validated: true,
    applicationReference: '60000000-0000-4000-8000-000000000002',
    kyc: { selfie_status: 'NOT_DONE' },
  },
} as OxygenRuntimeSnapshot;

it('lets the customer explicitly retry a definitively failed selfie link', () => {
  const submit = vi.fn().mockResolvedValue(true);
  render(
    <OxygenWorkflowError
      snapshot={snapshot}
      action="selfie_link"
      safeSelfieRetry
      activeLoan={false}
      error="unavailable"
      busy={false}
      submit={submit}
      refresh={vi.fn()}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Try selfie verification again' })
  );
  expect(submit).toHaveBeenCalledExactlyOnceWith({ action: 'selfie_link' });
});
