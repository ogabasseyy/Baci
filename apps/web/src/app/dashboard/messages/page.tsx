'use client';

import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useMerchantInbox } from '@/hooks/use-merchant-inbox';
import { cn } from '@/lib/utils';
import { ConversationList } from './conversation-list';
import { ConversationThread } from './conversation-thread';
import { ReplyBox } from './reply-box';

const STATE_MESSAGES = {
  loading: 'Loading your messages…',
  not_set_up: 'Messages are not set up for this store yet.',
  forbidden: 'You do not have permission to view customer messages.',
  unavailable:
    'Messages are temporarily unavailable. This page will retry automatically.',
} as const;

export default function MessagesPage() {
  const inbox = useMerchantInbox();
  const hasSelection = inbox.selectedId !== null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Messages</h1>
        <p className="text-muted-foreground">
          Chat with customers who message your store.
        </p>
      </div>

      {inbox.listState !== 'ready' ? (
        <Card className="p-6">
          <p
            role={inbox.listState === 'loading' ? 'status' : 'alert'}
            className="text-sm text-muted-foreground"
          >
            {STATE_MESSAGES[inbox.listState]}
          </p>
        </Card>
      ) : (
        <Card className="grid h-[70vh] min-h-[420px] overflow-hidden p-0 md:grid-cols-[minmax(240px,320px)_1fr]">
          <section
            aria-label="Conversations"
            className={cn(
              'overflow-y-auto md:border-r',
              hasSelection && 'hidden md:block'
            )}
          >
            <ConversationList
              conversations={inbox.conversations}
              selectedId={inbox.selectedId}
              onSelect={inbox.selectConversation}
            />
          </section>

          <section
            aria-label="Conversation"
            className={cn(
              'min-h-0 flex-col',
              hasSelection ? 'flex' : 'hidden md:flex'
            )}
          >
            {hasSelection ? (
              <>
                <header className="flex items-center gap-2 border-b px-4 py-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden"
                    aria-label="Back to conversations"
                    onClick={() => inbox.selectConversation(null)}
                  >
                    <ArrowLeft className="size-4" aria-hidden="true" />
                  </Button>
                  <h2 className="truncate font-semibold">
                    {inbox.selectedConversation?.customerName ?? 'Customer'}
                  </h2>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <ConversationThread
                    messages={inbox.messages}
                    state={inbox.threadState}
                  />
                </div>
                <ReplyBox
                  error={inbox.sendError}
                  sending={inbox.sending}
                  onSend={inbox.sendReply}
                />
              </>
            ) : (
              <p className="m-auto p-6 text-sm text-muted-foreground">
                Select a conversation to read and reply.
              </p>
            )}
          </section>
        </Card>
      )}
    </div>
  );
}
