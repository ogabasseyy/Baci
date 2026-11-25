import { describe, expect, it } from 'vitest';
import { conversation } from '@/test/messages-screen-support';
import { uniqueConversations } from './merchant-inbox-unique';

describe('uniqueConversations', () => {
  it('keeps the first copy of a chat and the order of the rest', () => {
    const first = conversation(1, 'Ada', 'customer');
    const other = conversation(2, 'Bola', 'store');
    const again = conversation(1, 'Ada again', 'customer');

    expect(uniqueConversations([first, other, again])).toEqual([first, other]);
  });

  it('returns nothing for no chats', () => {
    expect(uniqueConversations([])).toEqual([]);
  });
});
