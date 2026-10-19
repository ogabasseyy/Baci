import { z } from 'zod';
import { piggyvestGoalPolicySchemas } from './piggyvest-goal-policy';
import { piggyvestScheduleLifecycleSchemas as planner } from './piggyvest-schedule-lifecycle';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const request = z
  .strictObject({ operationId: uuid, command: planner.command })
  .refine(
    (value) =>
      value.command.action !== 'request_resume' ||
      value.operationId === value.command.operationId
  );
const receipt = z.strictObject({
  operationId: uuid,
  state: planner.state,
  persisted: z.literal(true),
  dispatch: z.literal('disabled'),
  debitPermission: z.literal(false),
});
const snapshot = z.strictObject({
  trusted: planner.input.shape.trusted,
  state: planner.state,
  token: z.string().regex(/^[0-9a-f]{32}$/),
  historical: z.strictObject({ command: planner.command, receipt }).nullable(),
});

export const piggyvestScheduleStoreSchemas = {
  configuration: piggyvestGoalPolicySchemas.configuration.extend({
    actorId: uuid,
  }),
  request,
  receipt,
  snapshot,
  readRows: z.array(z.strictObject({ result: snapshot })).length(1),
  writeRows: z.array(z.strictObject({ result: receipt })).length(1),
};
