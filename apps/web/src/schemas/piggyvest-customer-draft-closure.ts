import { piggyvestDraftClosureSchemas as shared } from '@baci/shared/contracts';
import { z } from 'zod';

type Selection = {
  goalId: string;
  command: z.infer<typeof shared.close> | undefined;
};

export const piggyvestCustomerDraftClosureSchemas = {
  ...shared,
  readSelection: shared.read.transform(
    (input): Selection => ({
      goalId: input.goalId.toLowerCase(),
      command: undefined,
    })
  ),
  closeSelection: shared.close.transform(
    (input): Selection => ({
      goalId: input.goalId.toLowerCase(),
      command: input,
    })
  ),
  rows: z.array(z.strictObject({ result: shared.response })).length(1),
};
