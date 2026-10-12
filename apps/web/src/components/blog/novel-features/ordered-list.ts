import { mergeAttributes } from '@tiptap/core';
import { OrderedList } from '@tiptap/extension-ordered-list';
import { cx } from 'class-variance-authority';

// Marker class follows the node's type attribute. A static
// list-decimal class would override non-default types (CSS beats the
// presentational attribute), so the reviewer would see decimal
// markers for an alphabetic list. Unknown values fall back to
// decimal, matching the browser's invalid-type rendering.
const ORDERED_LIST_MARKER_CLASS: Record<string, string> = {
  '1': 'list-decimal',
  a: 'list-[lower-alpha]',
  A: 'list-[upper-alpha]',
  i: 'list-[lower-roman]',
  I: 'list-[upper-roman]',
};

/**
 * Ordered list with type-driven markers. Start and type attributes
 * round-trip exactly like the upstream node; only the marker class
 * is dynamic so imported `<ol type="A">` renders alphabetically in
 * the editor instead of decimal.
 */
export const orderedList = OrderedList.extend({
  renderHTML({ HTMLAttributes }) {
    const { start, type, ...attributes } = HTMLAttributes;
    const attrs = mergeAttributes(this.options.HTMLAttributes, attributes, {
      class: cx(ORDERED_LIST_MARKER_CLASS[type as string] ?? 'list-decimal'),
    });
    if (start !== 1) attrs.start = start;
    if (type && type !== '1') attrs.type = type;
    return ['ol', attrs, 0];
  },
}).configure({
  HTMLAttributes: {
    class: cx('list-outside leading-3 -mt-2'),
  },
});
