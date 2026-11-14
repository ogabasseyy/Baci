import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { oxygenDiagnostic } from './provider-diagnostic';
import { recordOxygenFailure } from './record-failure';

it('records safe evidence and intent status through one worker RPC', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { recorded: true }, error: null });
  const diagnostic = oxygenDiagnostic('book', 'http', 'rejected', Date.now());
  await recordOxygenFailure(
    { rpc },
    'command',
    'workflow',
    'plan_required',
    'failed',
    diagnostic
  );
  expect(rpc).toHaveBeenCalledExactlyOnceWith('oxygen_finish_failure', {
    p_command_id: 'command',
    p_outcome: 'failed',
    p_stage: 'plan_required',
    p_diagnostic: diagnostic,
  });
});
it('fails closed and logs only identifiers when persistence is unavailable', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const rpc = vi.fn().mockResolvedValue({
    data: null,
    error: { code: 'private database detail' },
  });
  await expect(
    recordOxygenFailure(
      { rpc },
      'command',
      'workflow',
      'reconciliation_required',
      'indeterminate',
      oxygenDiagnostic('book', 'transport', 'indeterminate', Date.now())
    )
  ).rejects.toThrow('requires reconciliation');
  expect(log).toHaveBeenCalledWith('oxygen_failure_evidence_write_failed', {
    commandId: 'command',
    workflowId: 'workflow',
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain('private database');
  log.mockRestore();
});
it('does not expose a thrown database exception or silently release an unresolved intent', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await expect(
    recordOxygenFailure(
      {
        rpc: async () => {
          throw new Error('private database text');
        },
      },
      'command',
      'workflow',
      'plan_required',
      'failed',
      oxygenDiagnostic(null, 'validation', 'not_sent', Date.now())
    )
  ).rejects.toThrow('requires reconciliation');
  expect(JSON.stringify(log.mock.calls)).not.toContain('private database text');
  log.mockRestore();
});
