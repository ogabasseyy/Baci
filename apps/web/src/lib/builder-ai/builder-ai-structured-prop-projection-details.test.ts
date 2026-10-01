import { describe, expect, it } from 'vitest';
import { builderAiStructuredPropProjectionDetails } from './builder-ai-structured-prop-projection-details';

describe('builderAiStructuredPropProjectionDetails', () => {
  it('describes required nested member contracts independent of current values', () => {
    expect(
      builderAiStructuredPropProjectionDetails['Header.navigationLinks']
    ).toEqual({
      maximumItems: 8,
      uniqueBy: 'label',
      members: [
        {
          maximumLength: 120,
          name: 'label',
          required: true,
          valueType: 'string',
        },
        {
          maximumLength: 512,
          name: 'url',
          required: true,
          valueType: 'safe-storefront-url',
        },
      ],
    });
    expect(
      builderAiStructuredPropProjectionDetails['Footer.quickLinks']
    ).toEqual({
      maximumItems: 8,
      uniqueBy: 'label',
      members: [
        {
          maximumLength: 120,
          name: 'label',
          required: true,
          valueType: 'string',
        },
        {
          maximumLength: 512,
          name: 'url',
          required: true,
          valueType: 'safe-storefront-url',
        },
      ],
    });
    expect(
      builderAiStructuredPropProjectionDetails['Header.ctaButton']
    ).toMatchObject({
      members: [
        { name: 'show', required: true, valueType: 'boolean' },
        {
          maximumLength: 120,
          name: 'text',
          required: true,
          valueType: 'string',
        },
        {
          maximumLength: 512,
          name: 'url',
          required: true,
          valueType: 'safe-storefront-url',
        },
      ],
    });
  });

  it('keeps Features.features[].icon explicitly optional', () => {
    expect(
      builderAiStructuredPropProjectionDetails['Features.features']
    ).toMatchObject({
      maximumItems: 8,
      uniqueBy: 'title',
      members: expect.arrayContaining([
        expect.objectContaining({ name: 'icon', required: false }),
      ]),
      minimumItems: 1,
    });
  });
});
