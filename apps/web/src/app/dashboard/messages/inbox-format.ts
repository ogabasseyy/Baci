import type {
  MerchantInboxMessage,
  MerchantInboxSender,
} from '@/schemas/merchant-inbox';

const PREVIEW_MAX_LENGTH = 120;

/**
 * Time today, otherwise the day; empty for a missing or invalid value.
 * Uses the viewer's own locale unless one is given.
 */
export function formatInboxTime(
  iso: string | null,
  now: Date = new Date(),
  locale?: string
): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

export function senderLabel(sender: MerchantInboxSender): string {
  if (sender === 'customer') return 'Customer';
  if (sender === 'assistant') return 'Assistant';
  if (sender === 'system') return 'Automatic message';
  return 'You';
}

export function previewPrefix(sender: MerchantInboxSender): string {
  if (sender === 'store') return 'You: ';
  if (sender === 'assistant') return 'Assistant: ';
  return '';
}

/** Cuts at a length without leaving half of a surrogate pair (emoji). */
function sliceWholeCharacters(value: string, maxLength: number): string {
  const cut = value.slice(0, maxLength);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** One-line list preview, shortened in content and not only by CSS. */
export function inboxPreview(
  message: Pick<MerchantInboxMessage, 'sender' | 'text'>
): string {
  const line = message.text.replace(/\s+/g, ' ').trim();
  if (!line) {
    return `${previewPrefix(message.sender)}Attachment or unsupported message`;
  }
  const short =
    line.length > PREVIEW_MAX_LENGTH
      ? `${sliceWholeCharacters(line, PREVIEW_MAX_LENGTH).trimEnd()}…`
      : line;
  return `${previewPrefix(message.sender)}${short}`;
}
