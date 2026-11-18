import { z } from 'zod';

export type GoalActionKind = 'cancel' | 'complete';

const merchantId = z.uuid();
const goalId = z.uuid();
const operationId = z.uuid();
// Lower-case hex only, like the server. No message, so a refused value is
// never echoed back in an issue.
const pinProof = z.string().regex(/^[0-9a-f]{64}$/);

// Replies tolerate fields the app does not read; requests never send any
// field the server did not ask for.
export const GoalLifecycleSchemas = {
  // POST goal-X {step:'issue'}: the server mints the operation id.
  // Sent on a cancel: this client has shown that an early cancel forfeits
  // the goal's interest (the server refuses a forfeiting cancel without it).
  issueRequest: z
    .object({
      step: z.literal('issue'),
      merchantId,
      goalId,
      interestForfeitAcknowledged: z.literal(true).optional(),
    })
    .strict(),
  issueResponse: {
    cancel: z.object({
      status: z.enum(['issued', 'pending']),
      operationId,
    }),
    // 'confirmed' = this goal was already completed.
    complete: z.object({
      status: z.enum(['issued', 'pending', 'confirmed']),
      operationId,
    }),
  },
  // POST goal-X {step:'submit'}: the PIN proof, never the PIN or an amount.
  submitRequest: z
    .object({
      step: z.literal('submit'),
      merchantId,
      goalId,
      operationId,
      pinProof,
      interestForfeitAcknowledged: z.literal(true).optional(),
    })
    .strict(),
  submitResponse: z.object({
    status: z.enum(['confirmed', 'pending']),
    operationId,
  }),
  // PATCH goal-X: the only way to find out what happened.
  statusRequest: z.object({ merchantId, operationId }).strict(),
  statusResponse: z.object({
    status: z.enum(['pending', 'confirmed', 'needs_review', 'not_started']),
    operationId,
  }),
};
