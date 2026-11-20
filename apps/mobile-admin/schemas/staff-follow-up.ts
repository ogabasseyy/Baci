import { z } from 'zod';

export const staffFollowUpStages = [
  'needs_follow_up',
  'contacted',
  'waiting',
  'closed',
] as const;

export const STAFF_FOLLOW_UP_LABELS = {
  needs_follow_up: 'Needs follow-up',
  contacted: 'Contacted',
  waiting: 'Waiting',
  closed: 'Closed',
} as const satisfies Record<(typeof staffFollowUpStages)[number], string>;

export const STAFF_FOLLOW_UP_OUTCOME_LIMIT = 1000;

export const staffFollowUpDateSchema = z.iso
  .date()
  .refine((date) => date >= '1900-01-01' && date <= '9999-12-31');

export function limitStaffFollowUpOutcome(outcome: string): string {
  return [...outcome].slice(0, STAFF_FOLLOW_UP_OUTCOME_LIMIT).join('');
}

export const staffFollowUpSchema = z
  .object({
    order_id: z.uuid(),
    merchant_id: z.uuid(),
    assignee_id: z.uuid().nullable(),
    assignee_name: z
      .string()
      .min(1)
      .refine((name) => [...name].length <= 160),
    stage: z.enum(staffFollowUpStages),
    outcome: z
      .string()
      .refine((note) => [...note].length <= STAFF_FOLLOW_UP_OUTCOME_LIMIT),
    follow_up_on: staffFollowUpDateSchema.nullable(),
    revision: z.number().int().positive(),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .refine((row) => row.stage !== 'closed' || row.follow_up_on === null);

export type StaffFollowUp = z.infer<typeof staffFollowUpSchema>;
export type StaffFollowUpStage = StaffFollowUp['stage'];

export type StaffFollowUpUpdate = Pick<
  StaffFollowUp,
  'order_id' | 'revision' | 'stage' | 'outcome' | 'follow_up_on'
>;
