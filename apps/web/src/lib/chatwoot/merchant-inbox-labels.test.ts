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

describe('bugfix: tags stay within what the response allows', () => {
  it('does not split an astral letter when the slug is cut to the limit', () => {
    // NFKC turns U+FB03 into "ffi", so this 29-unit input grows to 31 units.
    const slug = slugifyInboxTag(`${'a'.repeat(26)}\uFB03\u{10400}`);

    expect(slug).toBe(`${'a'.repeat(26)}ffi`);
    expect(slug?.length).toBeLessThanOrEqual(30);
    expect(slug).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('keeps a whole astral letter that fits', () => {
    expect(slugifyInboxTag(`${'a'.repeat(27)}\u{10400}`)).toBe(
      `${'a'.repeat(27)}\u{10428}`
    );
  });

  it('shows at most ten tags, in label order', () => {
    const labels = Array.from({ length: 14 }, (_, i) => `tag-t${i}`);

    const tags = tagsFromLabels(labels);

    expect(tags).toHaveLength(10);
    expect(tags[0]).toBe('t0');
    expect(tags[9]).toBe('t9');
  });

  it('skips a tag label longer than a tag can be instead of breaking the page', () => {
    const tags = tagsFromLabels([`tag-${'x'.repeat(31)}`, 'tag-ok']);

    expect(tags).toEqual(['ok']);
  });

  it('skips a label with no usable letters or numbers', () => {
    expect(tagsFromLabels(['tag---', 'tag-!!', 'tag-ok'])).toEqual(['ok']);
  });
});

describe('bugfix: removing a tag also removes look-alike stored labels', () => {
  it('removes a stored label that has repeated separators', () => {
    const result = applyInboxLabelChange(
      ['tag-order--issue', 'handled-by-ai'],
      {
        removeTags: ['order-issue'],
      }
    );

    expect(result).toEqual(['handled-by-ai']);
  });

  it('removes a stored label written with underscores and capitals', () => {
    const result = applyInboxLabelChange(['tag-Order_Issue'], {
      removeTags: ['order-issue'],
    });

    expect(result).toEqual([]);
  });

  it('does not add a tag that already exists with repeated separators', () => {
    const result = applyInboxLabelChange(['tag-order--issue'], {
      addTags: ['order-issue'],
    });

    expect(result).toEqual(['tag-order--issue']);
  });
});
