import { describe, expect, it } from 'vitest';
import { OpsRefusal } from './ops-refusal';

describe('OpsRefusal', () => {
  it('is an error that carries the database refusal code', () => {
    const refusal = new OpsRefusal('ops_approval_expired');
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal.name).toBe('OpsRefusal');
    expect(refusal.code).toBe('ops_approval_expired');
    expect(refusal.message).toBe('ops_approval_expired');
  });
});
