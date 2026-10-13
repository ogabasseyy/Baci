import { builderDesignCapabilities } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { BUILDER_GEMINI_SYSTEM_PROMPT } from '@/app/api/builder/gemini-system-prompt';
import { COMPONENT_SCHEMA } from '@/components/builder/component-schema';
import { validateBuilderDesignCapabilities } from './validate-builder-design-capabilities';

describe('validateBuilderDesignCapabilities', () => {
  it('returns a coverage receipt for all registered Puck components', () => {
    expect(validateBuilderDesignCapabilities()).toMatchObject({
      classifiedComponentCount: 31,
      renderableComponentCount: 31,
      uncoveredComponentTypes: [],
    });
  });

  it('rejects a renderable component without an explicit manifest policy', () => {
    expect(() =>
      validateBuilderDesignCapabilities({
        componentTypes: ['Header', 'UnreviewedBlock'],
      })
    ).toThrow('UnreviewedBlock');
  });

  it('rejects client capability drift from a bounded shared property schema', () => {
    const drifted = structuredClone(builderDesignCapabilities);
    const hero = drifted.components.find(
      ({ componentType }) => componentType === 'Hero'
    );
    if (!hero) throw new Error('Expected Hero fixture');
    hero.props.title.maximumLength = 121;

    expect(() =>
      validateBuilderDesignCapabilities({ capabilities: drifted })
    ).toThrow('Hero.title');
  });

  it('rejects policy and structured descriptor drift', () => {
    const drifted = structuredClone(builderDesignCapabilities);
    const header = drifted.components.find(
      ({ componentType }) => componentType === 'Header'
    );
    if (!header) throw new Error('Expected Header fixture');
    header.aiInsertable = true;
    header.props.navigationLinks.maximumItems = 99;
    header.props.layout.enum = ['logo-center'];
    header.placement.allowedCollections = ['content'];

    expect(() =>
      validateBuilderDesignCapabilities({ capabilities: drifted })
    ).toThrow('Header');
  });

  it('keeps legacy prompt and schema views within shared capability boundaries', () => {
    const refused = builderDesignCapabilities.components.find(
      ({ componentType }) => componentType === 'CodeEmbed'
    );

    expect(COMPONENT_SCHEMA).not.toHaveProperty('CodeEmbed');
    expect(refused?.refused).toBe(true);
    expect(BUILDER_GEMINI_SYSTEM_PROMPT).toContain('CodeEmbed (unsafe-code)');
    expect(BUILDER_GEMINI_SYSTEM_PROMPT).toContain('Features: insert and edit');
  });
});
