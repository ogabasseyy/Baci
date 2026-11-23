import {
  type OxygenChatRequest,
  type OxygenChatResponse,
  oxygenChatRequestSchema,
  oxygenChatResponseSchema,
} from '@/schemas/oxygen-chat';
import type { OxygenWorkflowStage } from '@/schemas/oxygen-workflow';
import { getOxygenChatStep } from './chat-journey';

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
    prompt: getOxygenChatStep(workflow.stage).prompt,
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
