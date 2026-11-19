import { expect, it, vi } from 'vitest';

const { fetchWithCsrf } = vi.hoisted(() => ({ fetchWithCsrf: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf }));

import { sendOxygenWorkflowAction } from './oxygen-workflow-action-request';

it('advertises support for safe eligibility reasons and progress on action requests', () => {
  sendOxygenWorkflowAction('{}');
  expect(fetchWithCsrf).toHaveBeenCalledWith(
    '/api/payments/oxygen/workflows/actions',
    {
      method: 'POST',
      body: '{}',
      cache: 'no-store',
      headers: {
        'x-oxygen-eligibility-reason': '1',
        'x-oxygen-eligibility-progress': '1',
      },
    }
  );
});
