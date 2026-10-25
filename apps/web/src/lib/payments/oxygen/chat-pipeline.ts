import {
  type OxygenChatRequest,
  type OxygenChatResponse,
  oxygenChatRequestSchema,
  oxygenChatResponseSchema,
} from '@/schemas/oxygen-chat';
import type { OxygenWorkflowStage } from '@/schemas/oxygen-workflow';

const prompts: Record<OxygenWorkflowStage, string> = {
  application_required:
    'Continue your saved application securely. Enter identity details in the secure form, not in chat.',
  eligibility_required: 'Your application is awaiting an eligibility check.',
  kyc_required:
    'Continue securely to complete your remaining verification steps.',
  plan_required: 'Continue securely to review your payment plan.',
  booked: 'Your plan is booked. Review the next steps securely.',
  approval_required: 'Your plan is awaiting approval. Review it securely.',
  payment_required: 'Your application is awaiting the upfront payment step.',
  ready_for_activation:
    'Your application is ready for the next step. Activation remains disabled in this test.',
  activated: 'Your application status has been updated.',
  reconciliation_required:
    'Your application needs a status check before you continue. Do not repeat a payment.',
};

/** Deliberate whitelist. Never spread a runtime snapshot or saved draft into chat. */
export function projectOxygenChat(
  request: OxygenChatRequest,
  workflow: { id: string; stage: OxygenWorkflowStage; version: number }
): OxygenChatResponse {
  return oxygenChatResponseSchema.parse({
    messageId: request.messageId,
    channel: request.channel,
    application: {
      workflowId: workflow.id,
      stage: workflow.stage,
      version: workflow.version,
    },
    prompt: prompts[workflow.stage],
    actions: [
      {
        type: 'secure_handoff',
        label: 'Continue securely',
        path: `/payments/oxygen/${request.orderId}`,
      },
    ],
    activationEnabled: false,
    settlementEnabled: false,
  });
}

/**
 * Shared adapter for linked transports. The supplied transport must authenticate
 * the actual customer (web cookies or their normal bearer session). A WhatsApp
 * sender phone number, LLM tool call, or channel value is never authentication.
 * Keep credentials in the transport; never put them in messages or responses.
 */
export function createOxygenChatAdapter(
  channel: OxygenChatRequest['channel'],
  transport: (request: OxygenChatRequest) => Promise<unknown>
) {
  return {
    async handle(
      input: Omit<OxygenChatRequest, 'channel'>
    ): Promise<OxygenChatResponse> {
      const request = oxygenChatRequestSchema.parse({ ...input, channel });
      const response = oxygenChatResponseSchema.parse(await transport(request));
      if (
        response.channel !== channel ||
        response.messageId !== request.messageId ||
        response.actions.some(
          (action) => action.path !== `/payments/oxygen/${request.orderId}`
        )
      ) {
        throw new Error('Application response does not match this request');
      }
      return response;
    },
  };
}
