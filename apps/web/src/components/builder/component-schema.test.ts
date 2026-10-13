import { describe, expect, it } from 'vitest';
import { COMPONENT_SCHEMA } from './component-schema';

describe('COMPONENT_SCHEMA compatibility projection', () => {
  it('includes only components that are AI editable or insertable', () => {
    expect(COMPONENT_SCHEMA).toHaveProperty('Hero');
    expect(COMPONENT_SCHEMA).toHaveProperty('HeroCarousel');
    expect(COMPONENT_SCHEMA).not.toHaveProperty('CodeEmbed');
    expect(COMPONENT_SCHEMA).not.toHaveProperty('Image');
  });

  it('preserves manifest descriptions and bounded prop descriptors', () => {
    expect(COMPONENT_SCHEMA.Hero).toMatchObject({
      description: expect.any(String),
      props: expect.objectContaining({
        title: expect.objectContaining({ required: true, type: 'string' }),
      }),
    });
    expect(COMPONENT_SCHEMA.HeroCarousel).toMatchObject({
      props: expect.any(Object),
    });
  });
});
