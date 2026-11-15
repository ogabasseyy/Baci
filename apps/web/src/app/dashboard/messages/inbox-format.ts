import type { MerchantInboxSender } from '@/schemas/merchant-inbox';

const SAME_DAY = new Intl.DateTimeFormat('en-NG', {
  hour: 'numeric',
  minute: '2-digit',
});
const OTHER_DAY = new Intl.DateTimeFormat('en-NG', {
  day: 'numeric',
  month: 'short',
});

/** Time today, otherwise the day; empty for a missing or invalid value. */
export function formatInboxTime(
  iso: string | null,
  now: Date = new Date()
): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toDateString() === now.toDateString()
    ? SAME_DAY.format(date)
    : OTHER_DAY.format(date);
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
