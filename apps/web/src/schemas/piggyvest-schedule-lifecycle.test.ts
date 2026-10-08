import { expect, it } from 'vitest';
import { scheduleLifecycleFixture } from '@/lib/piggyvest/schedule-lifecycle.test-support';
import { piggyvestScheduleLifecycleSchemas as schemas } from './piggyvest-schedule-lifecycle';

it('accepts the explicit local snapshot and rejects extra authority fields', () => {
  const input = scheduleLifecycleFixture();
  expect(schemas.input.safeParse(input).success).toBe(true);
  expect(
    schemas.input.safeParse({ ...input, execute: 'provider' }).success
  ).toBe(false);
  expect(
    schemas.command.safeParse({
      ...input.command,
      actorId: input.trusted.actorId,
    }).success
  ).toBe(false);
});

it.each([
  { environment: 'production' },
  { transport: 'http' },
  { actorId: '' },
  { maturity: null },
  {
    maturity: {
      maturesAt: '2026-11-12T09:00:00Z',
      graceExpiresAt: '2026-11-11T09:00:00Z',
    },
  },
  {
    maturity: {
      maturesAt: '2026-10-12T09:00:00Z',
      graceExpiresAt: '2026-11-12T09:00:00Z',
    },
  },
])('rejects inconsistent local authority snapshot %j', (change) => {
  const input = scheduleLifecycleFixture();
  expect(
    schemas.input.safeParse({
      ...input,
      trusted: { ...input.trusted, ...change },
    }).success
  ).toBe(false);
});

it('rejects invalid versions and resume proposals without exact consent', () => {
  const input = scheduleLifecycleFixture();
  for (const version of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(schemas.state.safeParse({ ...input.state, version }).success).toBe(
      false
    );
  }
  expect(
    schemas.state.safeParse({ ...input.state, status: 'resume_proposed' })
      .success
  ).toBe(false);
  const resume = {
    ...input.command,
    action: 'request_resume',
    revisionId: input.trusted.revisionId,
    termsHash: input.trusted.termsHash,
    operationId: input.trusted.actorId,
  };
  expect(schemas.command.safeParse(resume).success).toBe(false);
  expect(
    schemas.command.safeParse({ ...resume, accepted: false }).success
  ).toBe(false);
  expect(schemas.command.safeParse({ ...resume, accepted: true }).success).toBe(
    true
  );
});
