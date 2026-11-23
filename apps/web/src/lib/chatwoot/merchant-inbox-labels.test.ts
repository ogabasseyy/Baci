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

  it('bugfix: treats underscores like hyphens so look-alike tags are one tag', () => {
    expect(slugifyInboxTag('order_issue')).toBe('order-issue');
    expect(slugifyInboxTag('Order_Issue')).toBe('order-issue');
    expect(slugifyInboxTag('a_b c')).toBe('a-b-c');
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

describe('bugfix: look-alike tags are the same tag', () => {
  it('does not add a second tag that reads the same as one already there', () => {
    // "order_issue" was created elsewhere; the app adds "Order issue".
    expect(
      applyInboxLabelChange(['tag-order_issue', 'handled-by-ai'], {
        addTags: ['order-issue'],
      })
    ).toEqual(['tag-order_issue', 'handled-by-ai']);
  });

  it('removes a tag created elsewhere with an underscore', () => {
    expect(
      applyInboxLabelChange(['tag-vip_buyer', 'needs-human'], {
        removeTags: ['vip-buyer'],
      })
    ).toEqual(['needs-human']);
  });

  it('removes every spelling of the tag at once', () => {
    expect(
      applyInboxLabelChange(['tag-order-issue', 'tag-order_issue'], {
        removeTags: ['order-issue'],
      })
    ).toEqual([]);
  });
});

describe('bugfix: tags created elsewhere with capitals are the same tag', () => {
  it('removes a tag stored as "Order_Issue" when asked to remove "order-issue"', () => {
    expect(
      applyInboxLabelChange(['tag-Order_Issue', 'needs-human'], {
        removeTags: ['order-issue'],
      })
    ).toEqual(['needs-human']);
  });

  it('does not add a second tag that differs from a stored one only by case', () => {
    expect(applyInboxLabelChange(['tag-VIP'], { addTags: ['vip'] })).toEqual([
      'tag-VIP',
    ]);
  });

  it('lists look-alike stored tags once', () => {
    expect(
      tagsFromLabels(['tag-order-issue', 'tag-Order_Issue', 'tag-lead'])
    ).toEqual(['order-issue', 'lead']);
  });
});
