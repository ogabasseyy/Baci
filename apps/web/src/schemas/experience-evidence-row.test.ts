import { expect, it } from 'vitest';
import {
  experienceEvidenceId,
  experienceEvidenceImageRow,
} from './experience-evidence-row';

const id = '11111111-1111-4111-8111-111111111111';
const row = {
  merchant_id: id,
  evidence_digest: 'a'.repeat(64),
  evidence_bytes: '\\x00ff',
};
it('accepts bound nonempty bytea evidence and rejects malformed locators and payloads', () => {
  expect(experienceEvidenceId.parse(id)).toBe(id);
  expect(experienceEvidenceId.safeParse('bad').success).toBe(false);
  expect(experienceEvidenceImageRow.parse(row)).toEqual(row);
  for (const patch of [
    { merchant_id: 'bad' },
    { evidence_digest: 'bad' },
    { evidence_bytes: '\\x' },
    { evidence_bytes: '\\x1' },
    { evidence_bytes: '00ff' },
    { evidence_bytes: '\\xzz' },
  ]) {
    expect(
      experienceEvidenceImageRow.safeParse({ ...row, ...patch }).success
    ).toBe(false);
  }
});
