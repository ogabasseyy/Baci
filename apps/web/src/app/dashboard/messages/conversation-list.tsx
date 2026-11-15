'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { MerchantInboxConversation } from '@/schemas/merchant-inbox';
import { formatInboxTime, previewPrefix } from './inbox-format';

type ConversationListProps = {
  conversations: MerchantInboxConversation[];
  onSelect: (conversationId: number) => void;
  selectedId: number | null;
};

export function ConversationList({
  conversations,
  onSelect,
  selectedId,
}: ConversationListProps) {
  if (conversations.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        No customer conversations yet. New chats from your store will appear
        here.
      </p>
    );
  }

  return (
    <ul aria-label="Customer conversations" className="divide-y">
      {conversations.map((conversation) => {
        const selected = conversation.id === selectedId;
        const last = conversation.lastMessage;
        return (
          <li key={conversation.id}>
            <button
              type="button"
              aria-current={selected ? 'true' : undefined}
              onClick={() => onSelect(conversation.id)}
              className={cn(
                'flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                selected && 'bg-muted'
              )}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="truncate font-medium">
                  {conversation.customerName}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatInboxTime(conversation.lastActivityAt)}
                </span>
              </span>
              <span className="flex items-center justify-between gap-3">
                <span className="truncate text-sm text-muted-foreground">
                  {last ? `${previewPrefix(last.sender)}${last.text}` : '—'}
                </span>
                {conversation.unreadCount > 0 && (
                  <Badge
                    aria-label={`${conversation.unreadCount} unread`}
                    className="shrink-0"
                  >
                    {conversation.unreadCount}
                  </Badge>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
