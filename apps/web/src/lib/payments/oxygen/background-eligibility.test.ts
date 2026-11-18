import { expect, it, vi } from 'vitest';
import { runOxygenEligibilityBackground } from './background-eligibility';

const { deliver } = vi.hoisted(() => ({ deliver: vi.fn() }));
type OffersReadyNotification = typeof import('./offers-ready-notification');

vi.mock('./offers-ready-notification', async (load) => ({
  ...(await load<OffersReadyNotification>()),
  sendOxygenOffersReady: deliver,
}));

const workflowId = '60000000-0000-4000-8000-000000000011';
const commandId = '60000000-0000-4000-8000-000000000012';
const applicationReference = '60000000-0000-4000-8000-000000000013';
const context = {
  workflowId,
  orderId: commandId,
  stage: 'eligibility_required',
  version: 1,
  environment: 'staging',
  partnerReference: 'partner',
  merchantReference: null,
  productAmount: 198000,
  orderPhone: '',
  productName: 'Test',
  address: 'Test',
  state: {
    applicationReference,
    validated: true,
    eligibilityStatus: 'pending',
    kyc: {
      phone_status: 'DONE',
      bvn_status: 'DONE',
      selfie_status: 'DONE',
      nin_status: 'DONE',
      bank_status: 'DONE',
      address_status: 'DONE',
    },
  },
};
const result = (data: unknown) => ({ data, error: null });

it('checks the original application and persists the offers without notifying on staging', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce(result({ workflowId, commandId }))
    .mockResolvedValueOnce(
      result({ context, command: { action: 'refresh_eligibility' } })
    )
    .mockResolvedValueOnce(result({ recorded: true }))
    .mockResolvedValueOnce(result(null));
  const call = vi.fn().mockResolvedValue({
    loan_request_reference: applicationReference,
    partner_reference: 'partner',
    status: 'COMPLETED',
    is_eligible: true,
    message: 'Eligible',
    eligible_amount: 192000,
    max_loan_amount: 192000,
    max_tenure: 3,
    tenure_unit: 'Monthly',
    offers: [{ tenor: 3, loan_amount: 192000 }],
  });
  await runOxygenEligibilityBackground({
    worker: { rpc },
    provider: { call },
    partner: 'partner',
    environment: 'staging',
    hosts: new Set(),
    deadlineMs: Date.now() + 120000,
  });
  expect(call).toHaveBeenCalledExactlyOnceWith('eligibility', {
    loan_request_reference: applicationReference,
    partner_reference: 'partner',
  });
  expect(rpc).toHaveBeenCalledWith(
    'oxygen_runtime',
    expect.objectContaining({
      p_operation: 'finish',
      p_id: commandId,
      p_payload: expect.objectContaining({
        stage: 'plan_required',
        state: expect.objectContaining({
          offers: [{ tenure: 3, loanAmount: 192000 }],
        }),
      }),
    })
  );
  expect(deliver).not.toHaveBeenCalled();
});

it('marks one claimed production notification after delivery', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce(result(null))
    .mockResolvedValueOnce(
      result({
        workflowId,
        orderId: commandId,
        merchantSlug: 'ogabassey',
        email: 'customer@example.test',
        pushToken: null,
      })
    )
    .mockResolvedValueOnce(result({ recorded: true }))
    .mockResolvedValueOnce(result(null));
  deliver.mockResolvedValueOnce(true);
  await runOxygenEligibilityBackground({
    worker: { rpc },
    provider: { call: vi.fn() },
    partner: 'partner',
    environment: 'production',
    hosts: new Set(),
    deadlineMs: Date.now() + 120000,
  });
  expect(deliver).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith(
    'oxygen_eligibility_background',
    expect.objectContaining({
      p_operation: 'finish_notification',
      p_payload: { workflowId, status: 'sent' },
    })
  );
});
