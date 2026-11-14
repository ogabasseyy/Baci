import { describe, expect, it } from 'vitest';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { isLegalPagePublishable } from './is-legal-page-publishable';

describe('isLegalPagePublishable', () => {
  it('returns true when merchant pages has custom content for the requested kind', () => {
    expect(
      isLegalPagePublishable(
        {
          template_id: 'default',
          pages: { privacy: '<p>Custom privacy policy</p>' },
        },
        'privacy'
      )
    ).toBe(true);

    expect(
      isLegalPagePublishable(
        {
          template_id: 'puck',
          pages: { terms: '<p>Custom terms and conditions</p>' },
        },
        'terms'
      )
    ).toBe(true);
  });

  it('returns true for Ogabassey template even without custom content', () => {
    expect(
      isLegalPagePublishable(
        {
          template_id: OGABASSEY_TEMPLATE_ID,
          pages: null,
        },
        'privacy'
      )
    ).toBe(true);

    expect(
      isLegalPagePublishable(
        {
          template_id: OGABASSEY_TEMPLATE_ID,
          pages: {},
        },
        'terms'
      )
    ).toBe(true);
  });

  it('returns false for default template without page content', () => {
    expect(
      isLegalPagePublishable(
        {
          template_id: 'default',
          pages: { privacy: null, terms: undefined },
        },
        'privacy'
      )
    ).toBe(false);

    expect(
      isLegalPagePublishable(
        {
          template_id: 'default',
          pages: null,
        },
        'terms'
      )
    ).toBe(false);
  });

  it('returns false for puck template without page content', () => {
    expect(
      isLegalPagePublishable(
        {
          template_id: 'puck',
          pages: {},
        },
        'privacy'
      )
    ).toBe(false);

    expect(
      isLegalPagePublishable(
        {
          template_id: 'puck',
          pages: null,
        },
        'terms'
      )
    ).toBe(false);
  });

  it('returns false for non-Ogabassey templates when custom page content is absent', () => {
    for (const templateId of ['boutique', 'restaurant', 'minimal', 'modern']) {
      expect(
        isLegalPagePublishable(
          {
            template_id: templateId,
            pages: null,
          },
          'privacy'
        )
      ).toBe(false);

      expect(
        isLegalPagePublishable(
          {
            template_id: templateId,
            pages: {},
          },
          'terms'
        )
      ).toBe(false);
    }
  });

  it('treats whitespace-only strings as empty page content', () => {
    expect(
      isLegalPagePublishable(
        {
          template_id: 'default',
          pages: { privacy: '   ', terms: '\n\t  ' },
        },
        'privacy'
      )
    ).toBe(false);

    expect(
      isLegalPagePublishable(
        {
          template_id: 'boutique',
          pages: { privacy: '\r\n  \t', terms: '    ' },
        },
        'terms'
      )
    ).toBe(false);
  });

  it('treats markup-only or empty HTML strings as unpublished for non-default templates', () => {
    expect(
      isLegalPagePublishable(
        {
          template_id: 'default',
          pages: { privacy: '<p> </p>', terms: '<p>&nbsp;</p>' },
        },
        'privacy'
      )
    ).toBe(false);

    expect(
      isLegalPagePublishable(
        {
          template_id: 'boutique',
          pages: { privacy: '<div>   </div>', terms: '<p>&#160;</p>' },
        },
        'terms'
      )
    ).toBe(false);
  });

  it('returns false when template_id is null or missing and page content is absent', () => {
    expect(
      isLegalPagePublishable(
        {
          template_id: null,
          pages: null,
        },
        'privacy'
      )
    ).toBe(false);

    expect(isLegalPagePublishable({}, 'terms')).toBe(false);
  });

  it('treats privacy and terms independently', () => {
    const merchant = {
      template_id: 'default',
      pages: {
        privacy: 'Privacy copy only',
        terms: null,
      },
    };

    expect(isLegalPagePublishable(merchant, 'privacy')).toBe(true);
    expect(isLegalPagePublishable(merchant, 'terms')).toBe(false);
  });
});
