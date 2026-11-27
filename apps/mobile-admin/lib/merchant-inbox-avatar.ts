/** Friendly faces for a chat's avatar, in place of two letters of its name. */
export const INBOX_AVATAR_EMOJI = [
  '🦊',
  '🐼',
  '🐸',
  '🦄',
  '🐙',
  '🐨',
  '🦁',
  '🐯',
  '🐵',
  '🐰',
  '🐻',
  '🐧',
  '🦉',
  '🐢',
  '🐳',
  '🦋',
] as const;

/** Each names a soft background in the theme, so dark mode keeps working. */
export const INBOX_AVATAR_TONES = [
  'primary',
  'gold',
  'success',
  'warning',
  'error',
  'info',
] as const;

export type InboxAvatarTone = (typeof INBOX_AVATAR_TONES)[number];

export interface InboxAvatar {
  emoji: (typeof INBOX_AVATAR_EMOJI)[number];
  tone: InboxAvatarTone;
}

/**
 * The same name always gets the same face and colour (FNV-1a over its
 * characters), on every screen and every launch, with nothing stored.
 */
export function inboxAvatar(seed: string): InboxAvatar {
  let hash = 2166136261;
  for (const character of seed.trim().toLowerCase()) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 16777619) >>> 0;
  }
  return {
    emoji: INBOX_AVATAR_EMOJI[hash % INBOX_AVATAR_EMOJI.length],
    tone: INBOX_AVATAR_TONES[(hash >>> 4) % INBOX_AVATAR_TONES.length],
  };
}
