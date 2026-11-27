import { CHAT_CUSTOMER_LINK_ATTRIBUTE } from '@/schemas/chat-customer-link';

type ChatwootConversationApi = {
  setConversationCustomAttributes?: (
    attributes: Record<string, string>
  ) => void;
  deleteConversationCustomAttribute?: (key: string) => void;
};

/** The widget only writes to a conversation it has loaded; send again after this. */
const REAPPLY_MS = 5_000;
const MESSAGE_EVENT = 'chatwoot:on-message';
const OPENED_EVENT = 'chatwoot:opened';

function write(value: string | null): boolean {
  const widget = (window as Window & { $chatwoot?: ChatwootConversationApi })
    .$chatwoot;
  try {
    if (
      value === null &&
      typeof widget?.deleteConversationCustomAttribute === 'function'
    ) {
      widget.deleteConversationCustomAttribute(CHAT_CUSTOMER_LINK_ATTRIBUTE);
      return true;
    }
    if (typeof widget?.setConversationCustomAttributes !== 'function') {
      return false;
    }
    // A widget with no delete call gets an empty value, which the inbox never
    // accepts, instead of keeping the previous shopper's note.
    widget.setConversationCustomAttributes({
      [CHAT_CUSTOMER_LINK_ATTRIBUTE]: value ?? '',
    });
    return true;
  } catch {
    // The widget may be mid-reload; a later event or page load tries again.
    return false;
  }
}

/**
 * Keeps the signed customer note on the shopper's CONVERSATION, never on their
 * contact: the chat engine merges contacts when anyone types a known email or
 * phone number, which would show a contact's note on that person's chat.
 *
 * In the chat engine (Chatwoot v4.19.1) a write replaces ALL of the
 * conversation's custom attributes, so nothing else may rely on them here.
 *
 * The widget writes only to the conversation it has loaded, so the latest state
 * (the note, or no note) is sent again shortly after, when the chat is opened,
 * and once for each conversation a message arrives on.
 */
export function createConversationNote() {
  // undefined: nothing to say yet; a string: the note; null: no note.
  let wanted: string | null | undefined;
  let sentTo = new Set<number>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const sendAgain = () => {
    if (wanted !== undefined) write(wanted);
  };
  const onMessage = (event: Event) => {
    const id = (event as CustomEvent<{ conversation_id?: unknown } | null>)
      .detail?.conversation_id;
    if (typeof id !== 'number' || wanted === undefined || sentTo.has(id)) {
      return;
    }
    if (write(wanted)) sentTo.add(id);
  };
  window.addEventListener(MESSAGE_EVENT, onMessage);
  window.addEventListener(OPENED_EVENT, sendAgain);

  const put = (value: string | null): boolean => {
    wanted = value;
    sentTo = new Set();
    clearTimeout(timer);
    timer = setTimeout(sendAgain, REAPPLY_MS);
    return write(value);
  };

  return {
    /** False when there is no widget to take it yet. */
    set: (token: string) => put(token),
    /** False when there is no widget to remove it from yet. */
    remove: () => put(null),
    dispose: () => {
      clearTimeout(timer);
      window.removeEventListener(MESSAGE_EVENT, onMessage);
      window.removeEventListener(OPENED_EVENT, sendAgain);
    },
  };
}
