// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationNote } from './chat-conversation-note';

const set = vi.fn();
const remove = vi.fn();
const contactSet = vi.fn();

const widget = (api: Record<string, unknown>) => {
  (window as unknown as { $chatwoot: unknown }).$chatwoot = api;
};
const message = (conversationId: unknown) =>
  window.dispatchEvent(
    new CustomEvent('chatwoot:on-message', {
      detail: { conversation_id: conversationId },
    })
  );

let note: ReturnType<typeof createConversationNote>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  widget({
    setConversationCustomAttributes: set,
    deleteConversationCustomAttribute: remove,
    setCustomAttributes: contactSet,
  });
  note = createConversationNote();
});

afterEach(() => {
  note.dispose();
  vi.useRealTimers();
  delete (window as unknown as { $chatwoot?: unknown }).$chatwoot;
});

describe('createConversationNote', () => {
  it('bugfix: writes on the conversation, never on the contact', () => {
    // Contacts are merged by email or phone, which would hand the note over.
    expect(note.set('signed.token')).toBe(true);

    expect(set).toHaveBeenCalledWith({ baci_customer_link: 'signed.token' });
    expect(contactSet).not.toHaveBeenCalled();
  });

  it('sends it again shortly after, for a conversation still loading', () => {
    note.set('signed.token');
    vi.advanceTimersByTime(5_000);

    expect(set).toHaveBeenCalledTimes(2);
  });

  it('sends it once for each conversation a message arrives on', () => {
    note.set('signed.token');
    set.mockClear();

    message(7);
    message(7);
    message(8);

    expect(set).toHaveBeenCalledTimes(2);
  });

  it('sends it again when the chat is opened', () => {
    note.set('signed.token');
    set.mockClear();

    window.dispatchEvent(new CustomEvent('chatwoot:opened'));

    expect(set).toHaveBeenCalledTimes(1);
  });

  it('keeps removing after a removal, and never re-sends the old note', () => {
    note.set('signed.token');
    set.mockClear();

    expect(note.remove()).toBe(true);
    message(7);
    vi.advanceTimersByTime(5_000);

    expect(remove).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalledWith('baci_customer_link');
    expect(set).not.toHaveBeenCalled();
  });

  it('says nothing before there is anything to say', () => {
    message(7);
    window.dispatchEvent(new CustomEvent('chatwoot:opened'));

    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    null,
    'x',
  ])('ignores a message naming no conversation (%s)', (conversationId) => {
    note.set('signed.token');
    set.mockClear();

    message(conversationId);

    expect(set).not.toHaveBeenCalled();
  });

  it('empties the value when the widget cannot delete', () => {
    widget({ setConversationCustomAttributes: set });

    expect(note.remove()).toBe(true);
    expect(set).toHaveBeenCalledWith({ baci_customer_link: '' });
  });

  it('reports failure with no widget, or one that throws', () => {
    delete (window as unknown as { $chatwoot?: unknown }).$chatwoot;
    expect(note.remove()).toBe(false);

    widget({
      deleteConversationCustomAttribute: () => {
        throw new Error('mid-reload');
      },
    });
    expect(note.remove()).toBe(false);
  });

  it('stops once disposed', () => {
    note.set('signed.token');
    set.mockClear();

    note.dispose();
    message(7);
    vi.advanceTimersByTime(5_000);

    expect(set).not.toHaveBeenCalled();
  });
});
