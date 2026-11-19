import {
  OXYGEN_DRAFT_FIELDS,
  type OxygenFormDraft,
} from '@/schemas/oxygen-form-draft';

// Compare only in memory; never log/hash identity values or persist them locally.
export function sameOxygenDraft(
  a: OxygenFormDraft | null,
  b: OxygenFormDraft
): boolean {
  return (
    !!a &&
    a.step === b.step &&
    OXYGEN_DRAFT_FIELDS.every(
      (key) => (a.fields[key] ?? '') === (b.fields[key] ?? '')
    )
  );
}
