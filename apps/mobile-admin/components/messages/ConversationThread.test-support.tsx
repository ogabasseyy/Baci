import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { ConversationThread } from './ConversationThread';

export const at = (m: number) => `2026-11-22T10:0${m}:00Z`;
export const messages = [
  {
    id: 1,
    sender: 'customer',
    kind: 'text',
    text: 'Is the phone in stock?',
    createdAt: at(0),
  },
  {
    id: 2,
    sender: 'assistant',
    kind: 'text',
    text: 'Let me check for you.',
    createdAt: at(1),
  },
  {
    id: 3,
    sender: 'store',
    kind: 'text',
    text: 'Yes we have it',
    createdAt: at(2),
  },
];

export function renderThread() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ConversationThread conversationId={9} />
    </QueryClientProvider>
  );
}
