import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  GiglWrapperSchemaMissingError,
  verifyGiglTrackingWorkerCapability,
  verifyGiglTrackingWorkerDelegationCanary,
  verifyGiglTrackingWorkerScopePathProbe,
  verifyGiglTrackingWorkerScopeProbe,
} from './verify-gigl-tracking-worker-capability';

describe('verifyGiglTrackingWorkerCapability', () => {
  it('accepts the reviewed invalid-limit response without claiming work', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'bounded validation failure' },
    });

    await expect(
      verifyGiglTrackingWorkerCapability({ rpc } as never)
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('claim_due_gigl_tracking_monitors', {
      p_limit: 0,
      p_worker_id: 'gigl-capability-preflight',
    });
  });

  it('fails closed when credentials or wrapper authority are rejected', async () => {
    for (const error of [
      { code: '42501', message: 'permission denied' },
      { code: 'PGRST301', message: 'invalid JWT' },
      { code: '42P01', message: 'relation "public.shipments" does not exist' },
      null,
    ]) {
      const rpc = vi.fn().mockResolvedValue({ data: null, error });

      await expect(
        verifyGiglTrackingWorkerCapability({ rpc } as never)
      ).resolves.toBe(false);
    }
  });

  it('throws schema-missing when the wrapper RPCs are not deployed yet', async () => {
    for (const error of [
      { code: 'PGRST202', message: 'not found' },
      {
        code: '404',
        message:
          'Could not find the function public.claim_due_gigl_tracking_monitors in the schema cache',
      },
      {
        code: '42704',
        message: 'role "gigl_tracking_worker" does not exist',
      },
      // Pre-isolation rollout: role and RPCs exist, authenticator grant
      // pending. Without this deferral deploy.sh refuses to install while
      // the workflow withholds the grant-fixing migrations (deadlock).
      {
        code: '42501',
        message: 'permission denied to set role "gigl_tracking_worker"',
      },
    ]) {
      const rpc = vi.fn().mockResolvedValue({ data: null, error });

      await expect(
        verifyGiglTrackingWorkerCapability({ rpc } as never)
      ).rejects.toBeInstanceOf(GiglWrapperSchemaMissingError);
    }
  });
});

describe('verifyGiglTrackingWorkerDelegationCanary', () => {
  it('passes only when the canary release reaches the inner RPC and writes nothing', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });

    await expect(
      verifyGiglTrackingWorkerDelegationCanary({ rpc } as never)
    ).resolves.toBe(true);
    // Fixed canary lease keys no live lease can match, through the
    // restricted client (which remaps to the allowlisted wrapper).
    expect(rpc).toHaveBeenCalledWith('release_gigl_tracking_claim', {
      p_shipment_id: '11111111-1111-4111-8111-111111111111',
      p_tracking_epoch_id: '22222222-2222-4222-8222-222222222222',
      p_worker_id: 'gigl-capability-delegation-canary',
    });
  });

  it('fails closed on broken elevation and unexpected results', async () => {
    // Broken elevation surfaces as the inner 42501 (the wrapper's own
    // 22023 guard passed, so only the post-validation path is left);
    // data other than false means the canary matched something — or
    // the contract changed — and must never latch.
    for (const response of [
      {
        data: null,
        error: {
          code: '42501',
          message: 'GIGL monitor claim release requires service role',
        },
      },
      { data: null, error: { code: '22023', message: 'invalid' } },
      { data: null, error: { code: 'PGRST301', message: 'invalid JWT' } },
      { data: true, error: null },
      { data: null, error: null },
    ]) {
      const rpc = vi.fn().mockResolvedValue(response);

      await expect(
        verifyGiglTrackingWorkerDelegationCanary({ rpc } as never)
      ).resolves.toBe(false);
    }
  });

  it('throws schema-missing when the wrapper RPCs are not deployed yet', async () => {
    for (const error of [
      { code: 'PGRST202', message: 'not found' },
      {
        code: '42501',
        message: 'permission denied to set role "gigl_tracking_worker"',
      },
    ]) {
      const rpc = vi.fn().mockResolvedValue({ data: null, error });

      await expect(
        verifyGiglTrackingWorkerDelegationCanary({ rpc } as never)
      ).rejects.toBeInstanceOf(GiglWrapperSchemaMissingError);
    }
  });
});

describe('verifyGiglTrackingWorkerScopeProbe', () => {
  it('passes only on the hook denial message over a GET request', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: '42501',
        message: 'GIGL worker request is outside its capability scope',
      },
    });

    await expect(
      verifyGiglTrackingWorkerScopeProbe({ rpc } as never)
    ).resolves.toBe(true);
    // GET — never HEAD: HEAD responses have no body, so supabase-js
    // surfaces a codeless `{ message: '' }` no matcher could pass.
    expect(rpc).toHaveBeenCalledWith(
      'claim_due_gigl_tracking_monitors',
      {
        p_limit: 0,
        p_worker_id: 'gigl-capability-scope-probe',
      },
      { get: true }
    );
  });

  it('fails closed when the wrapper answers without the hook', async () => {
    // 22023 is the missed-reload shape: the wrapper itself validated the
    // input, which proves the request reached it without hook enforcement.
    // The codeless empty message is the HEAD no-body shape: it must fail
    // closed too, so a future HEAD regression fails loudly instead of
    // latching on an unreadable denial.
    for (const error of [
      { code: '22023', message: 'bounded validation failure' },
      { code: '42501', message: 'permission denied for function foo' },
      { code: 'PGRST301', message: 'invalid JWT' },
      { message: '' },
      null,
    ]) {
      const rpc = vi.fn().mockResolvedValue({ data: null, error });

      await expect(
        verifyGiglTrackingWorkerScopeProbe({ rpc } as never)
      ).resolves.toBe(false);
    }
  });

  it('throws schema-missing when the wrapper RPCs are not deployed yet', async () => {
    for (const error of [
      { code: 'PGRST202', message: 'not found' },
      // Pre-isolation rollout defers here too (same shared matcher).
      {
        code: '42501',
        message: 'permission denied to set role "gigl_tracking_worker"',
      },
    ]) {
      const rpc = vi.fn().mockResolvedValue({ data: null, error });

      await expect(
        verifyGiglTrackingWorkerScopeProbe({ rpc } as never)
      ).rejects.toBeInstanceOf(GiglWrapperSchemaMissingError);
    }
  });

  it('matches the denial message raised by the scope-hook migration', async () => {
    const restoreMigration = readFileSync(
      join(
        process.cwd(),
        '../../supabase/migrations/20260805113000_restore_gigl_tracking_postgrest_capability.sql'
      ),
      'utf8'
    );
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'probe' },
    });

    // The probe only passes when the SQL message matches its expectation;
    // extract the migration's scope-denial literal (the reload canary
    // shares the 42501 errcode, so match by message, not position) and
    // require the probe to accept it.
    const raised = restoreMigration.match(
      /RAISE EXCEPTION '([^']*capability scope[^']*)'\s+USING ERRCODE = '42501'/
    );
    expect(raised?.[1]).toBe(
      'GIGL worker request is outside its capability scope'
    );
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: raised?.[1] },
    });
    await expect(
      verifyGiglTrackingWorkerScopeProbe({ rpc } as never)
    ).resolves.toBe(true);
  });
});

describe('verifyGiglTrackingWorkerScopePathProbe', () => {
  it('passes only on the hook denial for a POST outside the allowlist', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: '42501',
        message: 'GIGL worker request is outside its capability scope',
      },
    });

    await expect(
      verifyGiglTrackingWorkerScopePathProbe({ rpc } as never)
    ).resolves.toBe(true);
    // A plain POST (no `{ get: true }`) to the inner claim RPC: real
    // and schema-typed, but outside the five wrapper paths.
    expect(rpc).toHaveBeenCalledWith('claim_due_gigl_tracking_monitors', {
      p_limit: 0,
      p_worker_id: 'gigl-capability-path-probe',
    });
  });

  it('fails closed on a method-only hook without deferring', async () => {
    // A hook weakened to method-only lets this POST through to the
    // inner function, which raises before any write (it demands
    // service_role). That error — and a silent success — must fail
    // closed, never throw schema-missing: this probe runs strictly
    // after a schema-proving probe, so deferral would misread a
    // weakened hook as "not deployed yet".
    for (const error of [
      { code: '42501', message: 'GIGL monitor claims require service role' },
      { code: '22023', message: 'bounded validation failure' },
      { code: 'PGRST202', message: 'not found' },
      null,
    ]) {
      const rpc = vi.fn().mockResolvedValue({ data: null, error });

      await expect(
        verifyGiglTrackingWorkerScopePathProbe({ rpc } as never)
      ).resolves.toBe(false);
    }
  });
});
