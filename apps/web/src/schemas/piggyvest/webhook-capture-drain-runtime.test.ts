import { describe, expect, it } from 'vitest';
import {
  PIGGYVEST_CAPTURE_DRAIN_LOGIN,
  PIGGYVEST_CAPTURE_WORKER_ROLE,
  piggyvestCaptureDrainRuntimeSchema,
  piggyvestCaptureDrainSessionRowSchema,
  piggyvestCaptureResolveRowSchema,
  piggyvestCaptureStatusRowSchema,
} from './webhook-capture-drain-runtime';

const database = {
  host: 'db.example.supabase.co',
  port: 5432,
  name: 'postgres',
  login: PIGGYVEST_CAPTURE_DRAIN_LOGIN,
  password: 'placeholder-password',
  certificateAuthority: 'placeholder-ca',
};

describe('piggyvestCaptureDrainRuntimeSchema', () => {
  it('accepts the dedicated drain login with verified TLS material', () => {
    expect(piggyvestCaptureDrainRuntimeSchema.parse({ database })).toEqual({
      database,
    });
  });

  it.each([
    ['service_role', { login: 'service_role' }],
    ['another PiggyVest login', { login: 'baci_piggyvest_primary_evidence' }],
    ['a missing password', { password: '' }],
    ['a missing certificate authority', { certificateAuthority: '' }],
    ['a non-numeric port', { port: Number.NaN }],
    ['an IP address host', { host: '10.0.0.1' }],
  ])('refuses %s', (_label, override) => {
    expect(
      piggyvestCaptureDrainRuntimeSchema.safeParse({
        database: { ...database, ...override },
      }).success
    ).toBe(false);
  });

  it('refuses extra keys so nothing else can ride along', () => {
    expect(
      piggyvestCaptureDrainRuntimeSchema.safeParse({
        database,
        serviceRoleKey: 'x',
      }).success
    ).toBe(false);
  });

  it('names a login and a role distinct from every API role', () => {
    expect(PIGGYVEST_CAPTURE_DRAIN_LOGIN).toBe(
      'baci_piggyvest_webhook_capture_drain'
    );
    expect(PIGGYVEST_CAPTURE_WORKER_ROLE).toBe(
      'piggyvest_webhook_capture_worker'
    );
  });
});

describe('session and statement rows', () => {
  it('parses the session verification row', () => {
    const row = {
      database_name: 'postgres',
      login_name: PIGGYVEST_CAPTURE_DRAIN_LOGIN,
      role_name: PIGGYVEST_CAPTURE_DRAIN_LOGIN,
      login_safe: true,
      membership_count: 1,
      worker_membership: true,
      grants_usable: true,
      capture_surface_denied: true,
      unexpected_privileges: 0,
      tls: true,
    };
    expect(piggyvestCaptureDrainSessionRowSchema.parse(row)).toEqual(row);
    expect(
      piggyvestCaptureDrainSessionRowSchema.safeParse({ ...row, tls: 't' })
        .success
    ).toBe(false);
    for (const unreadable of [
      { grants_usable: null },
      { capture_surface_denied: 'f' },
      { unexpected_privileges: null },
      { unexpected_privileges: -1 },
      { unexpected_privileges: 1.5 },
    ]) {
      expect(
        piggyvestCaptureDrainSessionRowSchema.safeParse({
          ...row,
          ...unreadable,
        }).success
      ).toBe(false);
    }
    const { unexpected_privileges: _omitted, ...withoutCount } = row;
    expect(
      piggyvestCaptureDrainSessionRowSchema.safeParse(withoutCount).success
    ).toBe(false);
  });

  it('parses resolve and status rows and nothing looser', () => {
    expect(piggyvestCaptureResolveRowSchema.parse({ resolved: true })).toEqual({
      resolved: true,
    });
    expect(
      piggyvestCaptureResolveRowSchema.safeParse({ resolved: null }).success
    ).toBe(false);
    const status = {
      pending: 0,
      claimed: 0,
      needsReview: 0,
      claimRecoveryVersion: 1,
      oldestUnprocessedAt: null,
      lastCapturedAt: null,
      lastProcessedAt: null,
    };
    expect(piggyvestCaptureStatusRowSchema.parse({ status })).toEqual({
      status,
    });
    expect(
      piggyvestCaptureStatusRowSchema.safeParse({ status: {} }).success
    ).toBe(false);
  });
});
