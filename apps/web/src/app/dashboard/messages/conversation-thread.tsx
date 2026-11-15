'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { MerchantInboxThreadState } from '@/hooks/use-merchant-inbox';
import { cn } from '@/lib/utils';
import type { MerchantInboxMessage } from '@/schemas/merchant-inbox';
import { formatInboxTime, senderLabel } from './inbox-format';

type ConversationThreadProps = {
  messages: MerchantInboxMessage[];
  state: MerchantInboxThreadState;
};

/** Within this many pixels of the end counts as "reading the latest". */
const NEAR_BOTTOM_PX = 80;

export function ConversationThread({
  messages,
  state,
}: ConversationThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const [hasNewBelow, setHasNewBelow] = useState(false);
  const last = messages.at(-1);
  const lastId = last?.id;
  const lastIsMine = last?.sender === 'store';

  function scrollToLatest() {
    endRef.current?.scrollIntoView?.({ block: 'end' });
    nearBottomRef.current = true;
    setHasNewBelow(false);
  }

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    const nearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight <=
      NEAR_BOTTOM_PX;
    nearBottomRef.current = nearBottom;
    if (nearBottom) setHasNewBelow(false);
  }

  // Follow new messages only while the merchant is at the latest message (or
  // just sent one). Someone reading older history keeps their place and gets
  // a button instead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lastId is the trigger; refs and the latest sender are read at that moment.
  useEffect(() => {
    if (lastId === undefined) return;
    if (nearBottomRef.current || lastIsMine) {
      endRef.current?.scrollIntoView?.({ block: 'end' });
      nearBottomRef.current = true;
      setHasNewBelow(false);
    } else {
      setHasNewBelow(true);
    }
  }, [lastId]);

  let body: React.ReactNode;
  if (state === 'loading') {
    body = (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        Loading conversation…
      </p>
    );
  } else if (state === 'error') {
    body = (
      <p role="alert" className="p-6 text-sm text-destructive">
        This conversation could not be loaded. It will retry automatically.
      </p>
    );
  } else if (messages.length === 0) {
    body = (
      <p className="p-6 text-sm text-muted-foreground">No messages yet.</p>
    );
  } else {
    body = (
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
      </ol>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto"
      >
        {body}
        <div ref={endRef} />
      </div>
      {hasNewBelow && (
        <Button
          type="button"
          size="sm"
          onClick={scrollToLatest}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow"
        >
          New messages ↓
        </Button>
      )}
    </div>
  );
}
