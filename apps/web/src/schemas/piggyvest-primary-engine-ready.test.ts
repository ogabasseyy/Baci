import { describe, expect, it } from 'vitest';
import {
  piggyvestPrimaryEngineReadySchema,
  piggyvestPrimaryEngineSurfaceSchema,
} from './piggyvest-primary-engine-ready';

describe('piggyvest primary engine readiness schema', () => {
  it('accepts the stub verdict the database returns until the engine lands', () => {
    expect(
      piggyvestPrimaryEngineReadySchema.parse({
        ready: false,
        missing: ['engine_readiness_not_installed'],
      })
    ).toEqual({ ready: false, missing: ['engine_readiness_not_installed'] });
  });

  it('accepts a ready verdict only with nothing missing', () => {
    expect(
      piggyvestPrimaryEngineReadySchema.parse({ ready: true, missing: [] })
    ).toEqual({ ready: true, missing: [] });
    expect(
      piggyvestPrimaryEngineReadySchema.safeParse({
        ready: true,
        missing: ['heartbeat_stale'],
      }).success
    ).toBe(false);
  });

  it('rejects a not-ready verdict that names nothing missing', () => {
    expect(
      piggyvestPrimaryEngineReadySchema.safeParse({ ready: false, missing: [] })
        .success
    ).toBe(false);
  });

  it('rejects extra keys, wrong types and unbounded or free-text ids', () => {
    for (const value of [
      null,
      'ready',
      { ready: 'true', missing: [] },
      { ready: true, missing: [], detail: 'x' },
      { ready: false },
      { ready: false, missing: ['Engine Not Ready'] },
      { ready: false, missing: ['a'.repeat(64)] },
      { ready: false, missing: Array.from({ length: 65 }, () => 'gap') },
    ]) {
      expect(piggyvestPrimaryEngineReadySchema.safeParse(value).success).toBe(
        false
      );
    }
  });

  it('names the surfaces the inflow executor and bank inbox ask for', () => {
    expect(piggyvestPrimaryEngineSurfaceSchema.parse('inflow')).toBe('inflow');
    expect(piggyvestPrimaryEngineSurfaceSchema.parse('bank_inbox')).toBe(
      'bank_inbox'
    );
    expect(
      piggyvestPrimaryEngineSurfaceSchema.safeParse('everything').success
    ).toBe(false);
  });
});
