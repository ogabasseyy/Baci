import { expect, it } from 'vitest';
import { oxygenHostObservationQuery } from './oxygen-host-observation';

it('requires both workflow and command UUIDs', () => {
  const workflowId = 'f1ab0000-0000-4000-8000-000000000011';
  const commandId = 'f1ab0000-0000-4000-8000-000000000012';
  expect(
    oxygenHostObservationQuery.safeParse({ workflowId, commandId }).success
  ).toBe(true);
  expect(
    oxygenHostObservationQuery.safeParse({ workflowId, commandId: 'bad' })
      .success
  ).toBe(false);
  expect(oxygenHostObservationQuery.safeParse({ workflowId }).success).toBe(
    false
  );
  expect(
    oxygenHostObservationQuery.safeParse({ workflowId: 'bad', commandId })
      .success
  ).toBe(false);
  expect(oxygenHostObservationQuery.safeParse({ commandId }).success).toBe(
    false
  );
  expect(
    oxygenHostObservationQuery.parse({
      workflowId: workflowId.toUpperCase(),
      commandId: commandId.toUpperCase(),
    })
  ).toEqual({ workflowId, commandId });
});
