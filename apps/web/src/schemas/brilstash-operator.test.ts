import { describe, expect, it } from 'vitest';
import { brilStashOperatorCommands as commands } from './brilstash-operator';

const id = '30000000-0000-4000-8000-000000000001';
const installation = { p_installation_id: id };
const candidate = { ...installation, p_candidate_id: id };
const digest = 'a'.repeat(64);
const date = '2026-11-19';

describe('BrilStash activation and recovery schemas', () => {
  it('requires a real activation date and UUID-bound evidence and approval', () => {
    const args = {
      ...candidate,
      p_window_date: date,
      p_evidence_id: id,
      p_approval_id: id,
    };
    expect(commands.activate.args.parse(args)).toEqual(args);
    expect(
      commands.activate.args.safeParse({ ...args, p_window_date: '2026-02-30' })
        .success
    ).toBe(false);
    expect(
      commands.activate.args.safeParse({ ...args, p_approval_id: 'bad' })
        .success
    ).toBe(false);
  });

  it('accepts only fresh evidence with both import controls off and no pending jobs', () => {
    const args = {
      ...installation,
      p_partner_identity: 'partner-one',
      p_evidence_reference: 'verified readback',
      p_scheduled_enabled: false,
      p_manual_enabled: false,
      p_pending_job_count: 0,
      p_no_prior_import_or_stage: true,
    };
    const schema = commands['record-fresh-installation'].args;
    expect(schema.parse(args)).toEqual(args);
    for (const override of [
      { p_manual_enabled: true },
      { p_scheduled_enabled: true },
      { p_pending_job_count: 1 },
      { p_no_prior_import_or_stage: false },
    ])
      expect(schema.safeParse({ ...args, ...override }).success).toBe(false);
  });

  it('requires both verified recovery controls and caps the withdrawal list at seven', () => {
    const args = {
      ...candidate,
      p_suspension_id: id,
      p_approval_id: id,
      p_window_date: date,
      p_partner_evidence_reference: 'partner confirmation',
      p_off_sale_verified: true,
      p_prior_jobs_disposed: true,
      p_withdrawn_external_ids: Array.from(
        { length: 7 },
        (_, i) => `listing-${i}`
      ),
    };
    expect(commands.resume.args.parse(args)).toEqual(args);
    for (const override of [
      { p_off_sale_verified: false },
      { p_prior_jobs_disposed: false },
      { p_withdrawn_external_ids: [...args.p_withdrawn_external_ids, 'extra'] },
    ])
      expect(
        commands.resume.args.safeParse({ ...args, ...override }).success
      ).toBe(false);
  });

  it('accepts exact drain and promotion time boundaries', () => {
    const args = {
      ...installation,
      p_partner_drain_seconds: 86400,
      p_promotion_allowance_seconds: 3600,
      p_protected_until: '2026-11-19T23:59:00+01:00',
      p_evidence_reference: 'operator verified',
    };
    const schema = commands['configure-drain'].args;
    expect(schema.parse(args)).toEqual(args);
    for (const override of [
      { p_partner_drain_seconds: 86401 },
      { p_promotion_allowance_seconds: 0 },
      { p_promotion_allowance_seconds: 3601 },
      { p_protected_until: '2026-11-19T23:59:00' },
    ])
      expect(schema.safeParse({ ...args, ...override }).success).toBe(false);
  });
});

describe('BrilStash handoff and release schemas', () => {
  it('binds held connections to a run, attempt and result with imports off', () => {
    const args = { ...installation, p_probe_id: id };
    const saved = {
      partnerIdentity: 'partner-one',
      url: 'https://feed.example.invalid/partners/yield/brilpay/products?page=1&limit=100&min_price=0',
      configurationRevision: 'r'.repeat(256),
      requestId: id,
      pageProof: digest,
      evidenceReference: 'verified readback',
      importsDisabled: true,
      mode: 'saved',
    };
    const held = {
      ...saved,
      mode: 'held',
      runId: 'run',
      attemptId: 'attempt',
      stagedResultId: 'result',
    };
    const schema = commands['record-saved-connection'].args;
    expect(schema.parse({ ...args, p_connection: saved })).toEqual({
      ...args,
      p_connection: saved,
    });
    expect(schema.parse({ ...args, p_connection: held })).toEqual({
      ...args,
      p_connection: held,
    });
    for (const connection of [
      { ...held, stagedResultId: undefined },
      { ...saved, runId: 'unexpected' },
      { ...saved, importsDisabled: false },
      { ...saved, configurationRevision: 'r'.repeat(257) },
      { ...saved, url: 'http://feed.example.invalid' },
    ])
      expect(
        schema.safeParse({ ...args, p_connection: connection }).success
      ).toBe(false);
  });

  it('requires revision strings, lowercase digest, and an offset or UTC deadline for releases', () => {
    const request = {
      generationId: id,
      credentialId: id,
      catalogueRevision: '9223372036854775807',
      servingRevision: '3',
      credentialRevision: '0',
      payloadDigest: digest,
      configurationRevision: 'revision',
      runId: 'run',
      attemptId: 'attempt',
      stagedResultId: 'result',
      verificationId: id,
      applicationDeadline: '2026-11-19T22:59:00Z',
    };
    const schema = commands['record-release-request'].args;
    expect(schema.parse({ ...installation, p_request: request })).toEqual({
      ...installation,
      p_request: request,
    });
    for (const override of [
      { catalogueRevision: 3 },
      { servingRevision: '9'.repeat(20) },
      { credentialRevision: '-1' },
      { payloadDigest: digest.toUpperCase() },
      { applicationDeadline: '2026-11-19T22:59:00' },
      { verificationId: undefined },
    ])
      expect(
        schema.safeParse({
          ...installation,
          p_request: { ...request, ...override },
        }).success
      ).toBe(false);
  });

  it('allows a release-bound handoff check only alongside the saved verification', () => {
    const schema = commands['check-handoff'].args;
    expect(
      schema.safeParse({
        ...installation,
        p_probe_id: id,
        p_verification_id: id,
        p_release_id: id,
      }).success
    ).toBe(true);
    expect(
      schema.safeParse({ ...installation, p_probe_id: id, p_release_id: id })
        .success
    ).toBe(false);
  });
});

describe('bugfix: revisions beyond the PostgreSQL bigint maximum', () => {
  const maximum = '9223372036854775807';
  const overflow = '9223372036854775808';

  it.each([
    ['retire-installation', 'p_expected_revision', { p_reason: 'retired' }],
    ['abort-drain', 'p_closure_revision', {}],
  ] as const)('%s accepts the bigint maximum and rejects the next value', (name, field, extra) => {
    const schema = commands[name].args;
    const args = { ...installation, ...extra };
    expect(schema.safeParse({ ...args, [field]: maximum }).success).toBe(true);
    expect(schema.safeParse({ ...args, [field]: overflow }).success).toBe(
      false
    );
    expect(schema.safeParse({ ...args, [field]: '9'.repeat(19) }).success).toBe(
      false
    );
  });

  it('rejects an overflowing revision inside a release request', () => {
    const schema = commands['record-release-request'].args;
    const request = {
      generationId: id,
      credentialId: id,
      catalogueRevision: overflow,
      servingRevision: '3',
      credentialRevision: '0',
      payloadDigest: digest,
      configurationRevision: 'revision',
      runId: 'run',
      attemptId: 'attempt',
      stagedResultId: 'result',
      verificationId: id,
      applicationDeadline: '2026-11-19T22:59:00Z',
    };
    expect(
      schema.safeParse({ ...installation, p_request: request }).success
    ).toBe(false);
  });
});
