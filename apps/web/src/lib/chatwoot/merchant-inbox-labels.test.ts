import { describe, expect, it } from 'vitest';
import {
  applyInboxLabelChange,
  hasFollowUpLabel,
  slugifyInboxTag,
  tagsFromLabels,
} from './merchant-inbox-labels';

describe('slugifyInboxTag', () => {
  it('lowercases and joins words with a hyphen', () => {
    expect(slugifyInboxTag('Order Issue')).toBe('order-issue');
  });

  it('drops symbols and keeps letters from other languages', () => {
    expect(slugifyInboxTag('  Prix élevé!! ')).toBe('prix-élevé');
  });

  it('returns null when nothing usable remains', () => {
    expect(slugifyInboxTag('  !!! ')).toBeNull();
  });

  it('caps the length without leaving a trailing hyphen', () => {
    const slug = slugifyInboxTag(`${'a'.repeat(29)} bbbb`);
    expect(slug).toBe('a'.repeat(29));
  });
});

describe('tagsFromLabels', () => {
  it('returns only merchant tags, never system labels', () => {
    expect(
      tagsFromLabels(['handled-by-ai', 'tag-payment', 'follow-up', 'tag-lead'])
    ).toEqual(['payment', 'lead']);
  });
});

describe('applyInboxLabelChange', () => {
  it('keeps system labels while adding and removing tags', () => {
    expect(
      applyInboxLabelChange(['handled-by-ai', 'tag-old'], {
        addTags: ['payment'],
        removeTags: ['old'],
      })
    ).toEqual(['handled-by-ai', 'tag-payment']);
  });

  it('adds and removes the follow-up label', () => {
    const added = applyInboxLabelChange(['needs-human'], { followUp: true });
    expect(added).toEqual(['needs-human', 'follow-up']);
    expect(hasFollowUpLabel(added)).toBe(true);
    expect(applyInboxLabelChange(added, { followUp: false })).toEqual([
      'needs-human',
    ]);
  });

  it('does not exceed five tags', () => {
    const result = applyInboxLabelChange(['tag-a', 'tag-b', 'tag-c', 'tag-d'], {
      addTags: ['e', 'f'],
    });
    expect(tagsFromLabels(result)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('does not duplicate a tag that is already present', () => {
    expect(
      applyInboxLabelChange(['tag-payment'], { addTags: ['payment'] })
    ).toEqual(['tag-payment']);
  });
});
