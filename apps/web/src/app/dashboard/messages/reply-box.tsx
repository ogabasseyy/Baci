'use client';

import { Send } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { MerchantInboxApiErrorCode } from '@/lib/merchant-inbox-api';
import { MERCHANT_INBOX_REPLY_MAX_LENGTH } from '@/schemas/merchant-inbox';

type ReplyBoxProps = {
  error: MerchantInboxApiErrorCode | null;
  onSend: (content: string) => Promise<boolean>;
  sending: boolean;
};

function errorText(code: MerchantInboxApiErrorCode): string {
  if (code === 'delivery_unknown') {
    return 'We could not confirm this reply was sent. Check the conversation before sending it again.';
  }
  if (code === 'forbidden' || code === 'unauthorized') {
    return 'You do not have permission to reply to customers.';
  }
  if (code === 'not_found') return 'This conversation is no longer available.';
  return 'Your reply was not sent. Please try again.';
}

export function ReplyBox({ error, onSend, sending }: ReplyBoxProps) {
  const [draft, setDraft] = useState('');
  const canSend = draft.trim().length > 0 && !sending;

  async function submit() {
    if (!canSend) return;
    // Keep the draft unless the reply was accepted.
    if (await onSend(draft)) setDraft('');
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 border-t p-3">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(error)}
        </p>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          aria-label="Reply to customer"
          placeholder="Write a reply…"
          value={draft}
          maxLength={MERCHANT_INBOX_REPLY_MAX_LENGTH}
          // Locked while sending: text typed during the request would be
          // cleared together with the accepted draft.
          readOnly={sending}
          aria-busy={sending}
          rows={2}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          className="min-h-0 resize-none"
        />
        <Button type="submit" disabled={!canSend}>
          <Send className="size-4 mr-2" aria-hidden="true" />
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </form>
  );
}
