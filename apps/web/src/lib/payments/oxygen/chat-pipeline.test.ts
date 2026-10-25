import { describe, expect, it, vi } from 'vitest';
import {
  type OxygenChatRequest,
  oxygenChatRequestSchema,
} from '@/schemas/oxygen-chat';
import { oxygenWorkflowStageSchema } from '@/schemas/oxygen-workflow';
import { createOxygenChatAdapter, projectOxygenChat } from './chat-pipeline';
import {
  formatOxygenWebchatReply,
  formatOxygenWhatsAppReply,
} from './chat-replies';

const orderId = '8bb42a9f-9fb5-4ab4-a546-670e28f005f9';
const request = {
  orderId,
  messageId: 'message-1',
  channel: 'webchat' as const,
  intent: 'resume' as const,
};
const workflow = {
  id: orderId,
  stage: 'application_required' as const,
  version: 2,
};

describe('shared Oxygen chat pipeline', () => {
  it('projects only allowlisted stage metadata, even when storage contains sensitive data', () => {
    const response = projectOxygenChat(request, {
      ...workflow,
      ...{
        checkoutPhone: 'private-phone',
        address: 'private-address',
        state: {
          activityToken: 'private-token',
          selfieUrl: 'private-url',
          bvn: 'private-bvn',
        },
      },
    });
    expect(Object.keys(response.application)).toEqual([
      'workflowId',
      'stage',
      'version',
    ]);
    expect(JSON.stringify(response)).not.toContain('private-');
    expect(response.actions[0].path).toBe(`/payments/oxygen/${orderId}`);
    expect(response.activationEnabled).toBe(false);
    expect(response.settlementEnabled).toBe(false);
  });
  it.each(
    oxygenWorkflowStageSchema.options
  )('provides a safe continuation for %s', (stage) => {
    const result = projectOxygenChat(request, { ...workflow, stage });
    expect(result.prompt.length).toBeGreaterThan(10);
    expect(result.actions.map((a) => a.type)).toEqual(['secure_handoff']);
  });
  it.each([
    'activate',
    'approve_booking',
    'book',
    'settle',
    'cancel_booking',
    'submit_address',
  ])('rejects finance or sensitive action %s', (intent) => {
    expect(
      oxygenChatRequestSchema.safeParse({ ...request, intent }).success
    ).toBe(false);
  });
  it('rejects extra raw text, identity, or trusted principal fields', () => {
    for (const field of [
      'text',
      'bvn',
      'phone',
      'userId',
      'merchantId',
      'draft',
    ]) {
      expect(
        oxygenChatRequestSchema.safeParse({ ...request, [field]: 'secret' })
          .success
      ).toBe(false);
    }
  });
  it('resumes the identical order and workflow across transports', async () => {
    const transport = vi.fn(async (input: OxygenChatRequest) =>
      projectOxygenChat(input, workflow)
    );
    for (const channel of ['webchat', 'whatsapp'] as const) {
      const result = await createOxygenChatAdapter(channel, transport).handle({
        orderId,
        messageId: 'same-message',
        intent: 'resume',
      });
      expect(result.application.workflowId).toBe(workflow.id);
      expect(transport).toHaveBeenLastCalledWith({
        orderId,
        messageId: 'same-message',
        intent: 'resume',
        channel,
      });
    }
  });
  it('rejects mismatched delivery and unrecognized response data', async () => {
    const response = projectOxygenChat(request, workflow);
    const adapter = createOxygenChatAdapter('webchat', async () => ({
      ...response,
      messageId: 'wrong',
    }));
    await expect(
      adapter.handle({ orderId, messageId: 'message-1', intent: 'status' })
    ).rejects.toThrow('does not match');
    const unsafe = createOxygenChatAdapter('webchat', async () => ({
      ...response,
      bvn: 'secret',
    }));
    await expect(
      unsafe.handle({ orderId, messageId: 'message-1', intent: 'resume' })
    ).rejects.toThrow();
  });
  it('formats secure handoffs for either chat renderer without HTML or provider URLs', () => {
    const result = projectOxygenChat(request, workflow);
    const url = `https://shop.example/payments/oxygen/${orderId}`;
    expect(
      formatOxygenWhatsAppReply(result, 'https://shop.example').text
    ).toContain(url);
    expect(
      formatOxygenWebchatReply(result, 'https://shop.example').actions
    ).toEqual([{ label: 'Continue securely', href: url }]);
  });
  it.each([
    'http://shop.example',
    'https://name:secret@shop.example',
    'https://shop.example/?token=secret',
    'https://shop.example/path',
  ])('rejects unsafe handoff origin %s', (origin) => {
    expect(() =>
      formatOxygenWhatsAppReply(projectOxygenChat(request, workflow), origin)
    ).toThrow();
  });
});
