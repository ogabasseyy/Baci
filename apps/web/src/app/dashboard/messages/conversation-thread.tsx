'use client';

import { useEffect, useRef } from 'react';
import type { MerchantInboxThreadState } from '@/hooks/use-merchant-inbox';
import { cn } from '@/lib/utils';
import type { MerchantInboxMessage } from '@/schemas/merchant-inbox';
import { formatInboxTime, senderLabel } from './inbox-format';

type ConversationThreadProps = {
  messages: MerchantInboxMessage[];
  state: MerchantInboxThreadState;
};

export function ConversationThread({
  messages,
  state,
}: ConversationThreadProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const lastId = messages.at(-1)?.id;

  // Keep the newest message in view when one arrives.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lastId is the trigger; the ref is stable.
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [lastId]);

  if (state === 'loading') {
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        Loading conversation…
      </p>
    );
  }
  if (state === 'error') {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        This conversation could not be loaded. It will retry automatically.
      </p>
    );
  }
  if (messages.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">No messages yet.</p>
    );
  }

  return (
    <ol aria-label="Messages" className="flex flex-col gap-3 p-4">
      {messages.map((message) => {
        const mine = message.sender === 'store';
        const system = message.sender === 'system';
        return (
          <li
            key={message.id}
            className={cn(
              'flex max-w-[85%] flex-col gap-1',
              mine ? 'self-end items-end' : 'self-start items-start',
              system && 'self-center items-center max-w-full'
            )}
          >
            <span className="text-xs text-muted-foreground">
              {senderLabel(message.sender)}
              {message.kind === 'product_card' ? ' · Product card' : ''}
              {' · '}
              {formatInboxTime(message.createdAt)}
            </span>
            <p
              className={cn(
                'whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm',
                mine && 'bg-primary text-primary-foreground',
                !mine && !system && 'bg-muted',
                system && 'bg-transparent text-xs text-muted-foreground'
              )}
            >
              {message.text || 'Attachment or unsupported message'}
            </p>
          </li>
        );
      })}
      <div ref={endRef} />
    </ol>
  );
}
