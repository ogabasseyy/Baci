import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MerchantInboxApiErrorCode } from '@/lib/merchant-inbox-api';
import { ReplyBox } from './reply-box';

function setup(
  props: {
    error?: MerchantInboxApiErrorCode | null;
    onSend?: (content: string) => Promise<boolean>;
    sending?: boolean;
  } = {}
) {
  const onSend = props.onSend ?? vi.fn().mockResolvedValue(true);
  render(
    <ReplyBox
      error={props.error ?? null}
      onSend={onSend}
      sending={props.sending ?? false}
    />
  );
  return {
    onSend,
    box: screen.getByLabelText('Reply to customer') as HTMLTextAreaElement,
    send: screen.getByRole('button', { name: /Send|Sending/ }),
  };
}

describe('ReplyBox', () => {
  it('keeps Send disabled for a blank draft', async () => {
    const { box, send } = setup();
    expect((send as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(box, '   ');
    expect((send as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends the draft and clears it once accepted', async () => {
    const { box, onSend, send } = setup();
    await userEvent.type(box, 'Yes, in stock.');
    await userEvent.click(send);
    expect(onSend).toHaveBeenCalledWith('Yes, in stock.');
    expect(box.value).toBe('');
  });

  it('keeps the draft when the reply is not accepted', async () => {
    const { box, send } = setup({ onSend: vi.fn().mockResolvedValue(false) });
    await userEvent.type(box, 'Please wait');
    await userEvent.click(send);
    expect(box.value).toBe('Please wait');
  });

  it('sends on Enter but not on Shift+Enter', async () => {
    const { box, onSend } = setup();
    await userEvent.type(box, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(onSend).not.toHaveBeenCalled();
    await userEvent.type(box, '{Enter}');
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('line one\nline two');
  });

  it('locks the box and disables Send while sending', () => {
    const { box, send } = setup({ sending: true });
    expect(box.readOnly).toBe(true);
    expect(send.textContent).toContain('Sending');
    expect((send as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    ['delivery_unknown', 'Check the conversation before sending it again'],
    ['unauthorized', 'Sign in again'],
    ['forbidden', 'do not have permission'],
    ['not_found', 'no longer available'],
    ['temporarily_unavailable', 'not sent'],
  ] as const)('explains a %s failure', (code, text) => {
    setup({ error: code });
    expect(screen.getByRole('alert').textContent).toContain(text);
  });

  it('shows no alert without an error', () => {
    setup();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
