import { describe, expect, it, vi } from 'vitest';
import { runBrilStashOperatorCommand } from './operator-command';

const installation = '30000000-0000-4000-8000-000000000001';
const candidate = '70000000-0000-4000-8000-000000000001';
const approve = {
  action: 'approve-candidate',
  args: {
    p_installation_id: installation,
    p_candidate_id: candidate,
    p_payload_digest: 'a'.repeat(64),
  },
};

describe('BrilStash operator commands', () => {
  it('allows preview without apply and requires apply for writes', async () => {
    const rpc = vi.fn(async () => ({
      data: { candidateId: candidate },
      error: null,
    }));
    const client = { rpc };
    const input = {
      action: 'inspect-candidate',
      args: { p_installation_id: installation, p_candidate_id: candidate },
    };
    await expect(
      runBrilStashOperatorCommand(client, input, false)
    ).resolves.toEqual({ candidateId: candidate });
    await expect(
      runBrilStashOperatorCommand(client, approve, false)
    ).rejects.toThrow('requires --apply');
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'inspect_brilstash_candidate',
      input.args
    );
  });

  it('passes an explicit approved digest to the intended RPC and redacts database errors', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: 'backend details' },
    }));
    await expect(
      runBrilStashOperatorCommand({ rpc }, approve, true)
    ).rejects.toThrow('BrilStash operator command failed');
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'approve_brilstash_candidate',
      approve.args
    );
  });

  it('checks a release with both verification IDs and rejects one without verification', async () => {
    const rpc = vi.fn(async () => ({
      data: { partnerIdentity: 'partner-one' },
      error: null,
    }));
    const args = {
      p_installation_id: installation,
      p_probe_id: candidate,
      p_verification_id: candidate,
      p_release_id: candidate,
    };
    await expect(
      runBrilStashOperatorCommand(
        { rpc },
        { action: 'check-handoff', args },
        false
      )
    ).resolves.toEqual({ partnerIdentity: 'partner-one' });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'check_brilstash_handoff',
      args
    );
    await expect(
      runBrilStashOperatorCommand(
        { rpc },
        {
          action: 'check-handoff',
          args: { ...args, p_verification_id: undefined },
        },
        false
      )
    ).rejects.toThrow('Invalid BrilStash operator input');
  });

  it('rejects arbitrary function names and raw bearer inputs before RPC', async () => {
    const rpc = vi.fn();
    await expect(
      runBrilStashOperatorCommand(
        { rpc },
        { action: 'delete_everything', args: {} },
        true
      )
    ).rejects.toThrow('Invalid BrilStash operator input');
    await expect(
      runBrilStashOperatorCommand(
        { rpc },
        {
          action: 'rotate-credential',
          args: {
            p_installation_id: installation,
            p_expected_revision: '0',
            p_bearer_digest_hex: 'a'.repeat(64),
            p_overlap_seconds: 0,
            bearer: 'not passed',
          },
        },
        true
      )
    ).rejects.toThrow('Invalid BrilStash operator input');
    expect(rpc).not.toHaveBeenCalled();
  });
});
