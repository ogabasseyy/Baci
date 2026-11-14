import {
  OXYGEN_DRAFT_FIELDS,
  type OxygenFormDraft,
} from '@/schemas/oxygen-form-draft';

export function oxygenCustomerDraft(
  form: HTMLFormElement,
  step: number
): OxygenFormDraft {
  const data = new FormData(form);
  return {
    step: step as 0 | 1 | 2,
    fields: Object.fromEntries(
      OXYGEN_DRAFT_FIELDS.map((name) => [name, String(data.get(name) ?? '')])
    ),
  };
}
