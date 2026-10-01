import { describe, expect, it } from 'vitest';
import {
  allow,
  copy,
  deny,
  heroProps,
  label,
} from './builder-design-capability-props';

describe('builder design capability prop helpers', () => {
  it('omits absent defaults and preserves supplied label and copy defaults', () => {
    expect(label()).not.toHaveProperty('default');
    expect(copy()).not.toHaveProperty('default');
    expect(label('Shop')).toMatchObject({
      default: 'Shop',
      maximumLength: 120,
      type: 'string',
    });
    expect(copy('Details')).toMatchObject({
      default: 'Details',
      maximumLength: 2000,
      type: 'string',
    });
  });

  it('builds editable capabilities with explicit insertion and protection controls', () => {
    expect(allow('LegalSection', 'Policy', {}, false, true)).toMatchObject({
      aiEditable: true,
      aiInsertable: false,
      componentType: 'LegalSection',
      placement: { allowedCollections: ['content', 'zones'], kind: 'content' },
      protected: true,
      refused: false,
      renderable: true,
    });
  });

  it('builds refused capabilities as fixed, protected, and non-editable', () => {
    expect(deny('CodeEmbed', 'Code', 'unsafe-code', 'Not allowed')).toEqual({
      aiEditable: false,
      aiInsertable: false,
      componentType: 'CodeEmbed',
      description: 'Code',
      placement: { allowedCollections: [], kind: 'fixed' },
      protected: true,
      props: {},
      refusal: { code: 'unsafe-code', message: 'Not allowed' },
      refused: true,
      renderable: true,
      responsiveProps: [],
    });
  });

  it('requires nonempty Hero heading and CTA labels while retaining insert defaults', () => {
    expect(heroProps.ctaText).toMatchObject({
      default: 'Shop now',
      required: true,
      type: 'string',
    });
    expect(heroProps.title).toMatchObject({
      default: 'Featured collection',
      required: true,
      type: 'string',
    });
  });
});
