import type { OxygenRuntimeSnapshot } from '@baci/shared/oxygen';
import type { OxygenClient } from './client';
import { OxygenIntentJournal } from './journal';
import { createOxygenWorkflow } from './workflow';

export const id = '11111111-1111-4111-8111-111111111111';
export const scope = {
  storageKey: 'staging',
  userId: id,
  merchantId: id,
  orderId: id,
};
export const snapshot: OxygenRuntimeSnapshot = {
  workflowId: id,
  stage: 'application_required',
  version: 1,
  environment: 'staging',
  executionEnabled: true,
  state: {},
  approvalOtpReady: false,
  activationEnabled: false,
  settlementEnabled: false,
  checkoutPhone: '',
  checkoutAddress: {},
};
export function setup(
  overrides: Partial<Parameters<typeof createOxygenWorkflow>[0]> = {}
) {
  let stored: string | null = null;
  const storage = {
    getItem: jest.fn(() => Promise.resolve(stored)),
    setItem: jest.fn((_key: string, value: string) => {
      stored = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn(() => {
      stored = null;
      return Promise.resolve();
    }),
  };
  const client = {
    capabilities: jest.fn().mockResolvedValue({ mobileEnabled: true }),
    createOrResume: jest.fn().mockResolvedValue({ id, version: 1 }),
    snapshot: jest.fn().mockResolvedValue(snapshot),
    action: jest.fn().mockResolvedValue(snapshot),
    approvalWindow: jest.fn().mockResolvedValue({ window: null }),
  };
  const journal = new OxygenIntentJournal(storage, scope);
  const controller = createOxygenWorkflow({
    client: client as unknown as OxygenClient,
    journal,
    key: () => id,
    findSaved: async () => id,
    ...overrides,
  });
  return { client, journal, storage, controller };
}
