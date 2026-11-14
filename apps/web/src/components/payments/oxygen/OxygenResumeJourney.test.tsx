import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
  createOxygenChatAdapter,
  projectOxygenChat,
} from '@/lib/payments/oxygen/chat-pipeline';
import {
  type OxygenFormDraft,
  oxygenDraftWriteSchema,
} from '@/schemas/oxygen-form-draft';

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: api.fetch }));

import { OxygenCustomerForm } from './OxygenCustomerForm';

it.each([
  'webchat',
  'whatsapp',
] as const)('restores autosaved fields through the same authenticated %s handoff without exposing identity data in chat', async (channel) => {
  const id = '80dca25f-3173-452f-846b-21e5188ff52b';
  const storage: { draft: OxygenFormDraft | null; version: number } = {
    draft: null,
    version: 0,
  };
  api.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('/bank-details'))
      return Response.json({
        banks: [{ code: '001', name: 'Synthetic Bank' }],
      });
    if (url.includes('/draft?')) return Response.json(storage);
    if (url.endsWith('/draft') && init?.method === 'PUT') {
      const next = oxygenDraftWriteSchema.parse(JSON.parse(String(init.body)));
      expect(next.workflowId).toBe(id);
      storage.draft = next.draft;
      storage.version += 1;
      return Response.json({ version: storage.version });
    }
    throw new Error('Unexpected fixture request');
  });
  const props = {
    workflowId: id,
    phone: '08012345678',
    busy: false,
    submit: vi.fn(),
  };
  const first = render(<OxygenCustomerForm {...props} />);
  await screen.findByLabelText('BVN');
  fireEvent.change(screen.getByLabelText('BVN'), {
    target: { value: '12345678901' },
  });
  fireEvent.change(screen.getByLabelText('NIN'), {
    target: { value: '12345678902' },
  });
  fireEvent.blur(screen.getByLabelText('NIN'));
  await waitFor(() => expect(storage.draft?.fields.nin).toBe('12345678902'));
  first.unmount();
  const adapter = createOxygenChatAdapter(channel, async (request) => {
    await Promise.resolve();
    return projectOxygenChat(request, {
      id,
      stage: 'application_required',
      version: storage.version,
    });
  });
  const reply = await adapter.handle({
    orderId: id,
    messageId: 'resume-fixture',
    intent: 'resume',
  });
  expect(reply.application.workflowId).toBe(id);
  expect(reply.actions[0].path).toBe(`/payments/oxygen/${id}`);
  expect(JSON.stringify(reply)).not.toContain('12345678901');
  expect(JSON.stringify(reply)).not.toContain('12345678902');
  render(<OxygenCustomerForm {...props} />);
  expect(await screen.findByLabelText('BVN')).toHaveValue('12345678901');
  expect(screen.getByLabelText('BVN')).toHaveAttribute('type', 'password');
  expect(screen.getByLabelText('NIN')).toHaveValue('12345678902');
  expect(screen.getByRole('checkbox', { hidden: true })).not.toBeChecked();
  expect(reply.activationEnabled).toBe(false);
  expect(reply.settlementEnabled).toBe(false);
  expect(storage.draft?.fields).not.toHaveProperty('otp');
  expect(storage.draft?.fields).not.toHaveProperty('consent');
});
