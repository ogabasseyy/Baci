import { describe, expect, it } from 'vitest';
import {
  commandAllowed,
  projectWorkflow,
  runWorkflowCommand,
} from './workflow';

describe('durable Oxygen workflow', () => {
  it('keeps activation and settlement outside customer commands', () => {
    expect(
      commandAllowed('ready_for_activation', {
        action: 'refresh_payment_setup',
      })
    ).toBe(true);
    expect(projectWorkflow('ready_for_activation').nextStep).toBe(
      'activation_disabled'
    );
    expect(projectWorkflow('activated').settlement).toBe('unverified');
  });
  it('requires cancellation before changing a booked plan', () => {
    expect(
      commandAllowed('booked', {
        action: 'book',
        equityPercentage: 35,
        tenure: 3,
      })
    ).toBe(false);
    expect(commandAllowed('booked', { action: 'cancel_booking' })).toBe(true);
  });
  it('does not call the provider when durable claim fails', async () => {
    let called = false;
    await runWorkflowCommand(
      { claim: async () => null, record: async () => {} },
      async () => {
        called = true;
        return 'booked';
      }
    );
    expect(called).toBe(false);
  });
  it('records uncertainty instead of retrying a failed provider call', async () => {
    let calls = 0;
    const recorded: unknown[] = [];
    await runWorkflowCommand(
      {
        claim: async () => ({
          id: 'command',
          environment: 'staging',
          stage: 'plan_required',
          command: { action: 'book', equityPercentage: 35, tenure: 3 },
        }),
        record: async (...args) => {
          recorded.push(args);
        },
      },
      async () => {
        calls++;
        throw new Error('private provider detail');
      }
    );
    expect(calls).toBe(1);
    expect(recorded).toEqual([
      ['command', 'indeterminate', 'reconciliation_required'],
    ]);
  });
  it('persists a successful result and propagates a persistence failure without retrying', async () => {
    let calls = 0;
    await expect(
      runWorkflowCommand(
        {
          claim: async () => ({
            id: 'command',
            environment: 'staging',
            stage: 'booked',
            command: { action: 'cancel_booking' },
          }),
          record: async () => {
            throw new Error('storage unavailable');
          },
        },
        async () => {
          calls++;
          return 'plan_required';
        }
      )
    ).rejects.toThrow('storage unavailable');
    expect(calls).toBe(1);
  });
  it('rejects invalid stage changes even from a provider adapter', async () => {
    const recorded: unknown[] = [];
    await runWorkflowCommand(
      {
        claim: async () => ({
          id: 'command',
          environment: 'staging',
          stage: 'plan_required',
          command: { action: 'book', equityPercentage: 35, tenure: 3 },
        }),
        record: async (...args) => {
          recorded.push(args);
        },
      },
      async () => 'activated'
    );
    expect(recorded).toEqual([
      ['command', 'indeterminate', 'reconciliation_required'],
    ]);
  });
});

it('never executes production commands while rollout is disabled', async () => {
  let calls = 0;
  await runWorkflowCommand(
    {
      claim: async () => ({
        id: 'command',
        environment: 'production',
        stage: 'plan_required',
        command: { action: 'book', equityPercentage: 35, tenure: 3 },
      }),
      record: async () => {},
    },
    async () => {
      calls++;
      return 'booked';
    }
  );
  expect(calls).toBe(0);
});
