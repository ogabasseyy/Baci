import { z } from 'zod';

const uuid = z.uuid().transform((value) => value.toLowerCase());

const readResult = z.strictObject({
  status: z.literal('absent'),
  caseId: uuid,
  goalId: uuid,
  financialEffects: z.literal('UNKNOWN'),
  fundsUse: z.literal('not_authorized'),
  dispatch: z.literal('disabled'),
});
const listResult = z.strictObject({
  goalId: uuid,
  cases: z.array(z.strictObject({ caseId: uuid })),
});

export const reconciliationCasesSchemas = {
  request: z.union([
    z.strictObject({ goalId: uuid, collectionOperationId: uuid }),
    z.strictObject({ goalId: uuid, after: uuid.nullable() }),
  ]),
  readRows: z.array(z.strictObject({ result: readResult })).length(1),
  listRows: z.array(z.strictObject({ result: listResult })).length(1),
};
