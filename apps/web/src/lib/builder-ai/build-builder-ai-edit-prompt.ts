import type {
  BuilderAiModelOperation,
  BuilderData,
} from '@baci/shared/contracts';
import { builderDesignCapabilities } from '@baci/shared/contracts';
import {
  getBuilderAiCatalogProjection,
  isAiEditableComponent,
} from './builder-ai-component-catalog';
import { getBuilderAiAggregatePlanLimits } from './get-builder-ai-aggregate-plan-limits';
import { getBuilderAiCapabilityPolicy } from './get-builder-ai-capability-policy';
import { getBuilderAiContentCollectionEntries } from './get-builder-ai-content-collection-entries';
import { getBuilderAiContentCollections } from './get-builder-ai-content-collections';
import { getBuilderAiSpecialOperationGuidance } from './get-builder-ai-special-operation-guidance';
import { isRenderedH1Hero } from './is-rendered-h1-hero';
import { sanitizeBuilderAiProps } from './sanitize-builder-ai-props';

interface PromptInput {
  currentConfig: BuilderData;
  prompt: string;
}

const operationExamples = [
  {
    componentId: 'component-id',
    kind: 'update_component',
    patch: { componentType: 'Hero', title: 'Updated title' },
  },
  {
    componentId: 'carousel-id',
    kind: 'update_carousel_slide',
    slideIndex: 0,
    title: 'Updated slide',
  },
  {
    initialContent: { componentType: 'Text', content: 'Supporting copy' },
    kind: 'insert_component',
    placement: { collection: 'content', position: 'first_content' },
  },
  {
    initialContent: { componentType: 'Text', content: 'Supporting copy' },
    kind: 'insert_component',
    placement: { componentId: 'component-id', position: 'after' },
  },
  { componentId: 'component-id', kind: 'remove_component' },
  {
    componentId: 'component-id',
    destination: { collection: 'content', position: 'first_content' },
    kind: 'move_component',
  },
  {
    componentId: 'source-component-id',
    destination: { componentId: 'anchor-component-id', position: 'after' },
    kind: 'move_component',
  },
  { kind: 'update_theme', preset: 'modern' },
  { kind: 'update_root', title: 'Page title' },
] satisfies BuilderAiModelOperation[];

export const MAX_PROMPT_PROJECTED_COMPONENTS = 100;
export const MAX_PROMPT_PROJECTION_CHARS = 16_384;
const MAX_PROMPT_ROOT_TITLE_CHARS = 200;
const MAX_PROMPT_THEME_COLOR_CHARS = 100;
const baseThemeColorKeys = [
  'primary',
  'secondary',
  'accent',
  'background',
  'foreground',
  'muted',
  'mutedForeground',
  'border',
] as const;
const themePresetNames = [
  'modern',
  'minimal',
  'luxury',
  'playful',
  'bold',
  'calm',
] as const;

export class BuilderAiPromptProjectionTooLargeError extends Error {
  constructor() {
    super('Builder AI prompt projection exceeds safety limit');
    this.name = 'BuilderAiPromptProjectionTooLargeError';
  }
}

function clean(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : character;
  })
    .join('')
    .trim()
    .slice(0, 1000);
}

function serializeQuotedData(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function projectCarouselSlides(props: Record<string, unknown>): unknown[] {
  if (!Array.isArray(props.slides)) return [];
  return props.slides.slice(0, 5).map((slide) => {
    if (!isRecord(slide)) return {};
    const { props: safeSlide } = sanitizeBuilderAiProps('Hero', slide);
    return safeSlide;
  });
}

function getCurrentStateProjection(currentConfig: BuilderData): {
  root: { title?: string };
  theme: { colors: Record<string, string> };
} {
  const rootProps = isRecord(currentConfig.root.props)
    ? currentConfig.root.props
    : {};
  const title = rootProps.title ?? currentConfig.root.title;
  const themeColors = isRecord(currentConfig.theme?.colors)
    ? currentConfig.theme.colors
    : {};
  const colors = Object.fromEntries(
    baseThemeColorKeys.flatMap((key) => {
      const value = themeColors[key];
      return typeof value === 'string'
        ? [[key, clean(value).slice(0, MAX_PROMPT_THEME_COLOR_CHARS)]]
        : [];
    })
  );
  return {
    root:
      typeof title === 'string'
        ? { title: clean(title).slice(0, MAX_PROMPT_ROOT_TITLE_CHARS) }
        : {},
    theme: { colors },
  };
}

function project(currentConfig: BuilderData): Array<{
  collection: string;
  id: string;
  props?: Record<string, unknown>;
  type: string;
}> {
  const projection: Array<{
    collection: string;
    id: string;
    props?: Record<string, unknown>;
    type: string;
  }> = [];
  for (const { collection, content } of getBuilderAiContentCollectionEntries(
    currentConfig
  )) {
    for (const component of content) {
      const id = component.props.id;
      if (typeof id !== 'string' || id.length === 0) continue;
      if (!isAiEditableComponent(component.type)) {
        projection.push({ collection, id, type: component.type });
        continue;
      }
      const { props } = sanitizeBuilderAiProps(component.type, component.props);
      if (component.type === 'HeroCarousel') {
        projection.push({
          collection,
          id,
          props: { slides: projectCarouselSlides(component.props) },
          type: component.type,
        });
        continue;
      }
      projection.push({ collection, id, props, type: component.type });
    }
  }
  return projection;
}

function getRemovalConstraints(currentConfig: BuilderData): {
  protectedComponentIds: string[];
  requiredComponentGroups: Array<{
    componentIds: string[];
    componentType: 'ProductGrid' | 'renderedH1Hero';
    minimumRetained: 1;
  }>;
} {
  const components = getBuilderAiContentCollections(currentConfig).flat();
  const matching = (
    predicate: (component: BuilderData['content'][number]) => boolean
  ) => components.filter(predicate);
  const componentIds = (matches: BuilderData['content']): string[] =>
    matches.flatMap((component) => {
      const id = component.props.id;
      return typeof id === 'string' && id.length > 0 ? [id] : [];
    });
  const soleId = (matches: BuilderData['content']): string[] => {
    const id = matches[0]?.props.id;
    return matches.length === 1 && typeof id === 'string' && id.length > 0
      ? [id]
      : [];
  };
  const productGrids = matching(
    (component) => component.type === 'ProductGrid'
  );
  const h1Heroes = matching(isRenderedH1Hero);
  return {
    protectedComponentIds: [...soleId(productGrids), ...soleId(h1Heroes)],
    requiredComponentGroups: [
      ...(productGrids.length > 0
        ? [
            {
              componentIds: componentIds(productGrids),
              componentType: 'ProductGrid' as const,
              minimumRetained: 1 as const,
            },
          ]
        : []),
      ...(h1Heroes.length > 0
        ? [
            {
              componentIds: componentIds(h1Heroes),
              componentType: 'renderedH1Hero' as const,
              minimumRetained: 1 as const,
            },
          ]
        : []),
    ],
  };
}

export function buildBuilderAiEditPrompt({
  currentConfig,
  prompt,
}: PromptInput): string {
  const capabilityPolicy = getBuilderAiCapabilityPolicy(
    builderDesignCapabilities
  );
  const operationGuidance = serializeQuotedData({
    allowedComponentTypes: capabilityPolicy.allowedComponentTypes,
    aggregatePlanLimits: getBuilderAiAggregatePlanLimits(),
    capabilityPolicy,
    catalog: getBuilderAiCatalogProjection(),
    currentState: getCurrentStateProjection(currentConfig),
    operationExamples,
    placementCollections: getBuilderAiContentCollectionEntries(
      currentConfig
    ).map(({ collection }) => collection),
    updateThemeOperation: {
      colors: {
        allowedKeys: capabilityPolicy.themeTokenKeys,
        minimumProperties: 1,
        valuePattern: '#RRGGBB',
      },
      kind: 'update_theme',
      preset: { allowedValues: themePresetNames },
      requiresAtLeastOneOf: ['preset', 'colors'],
    },
    removalConstraints: {
      instruction:
        'Do not remove protected ids or reduce any required component group below its minimum.',
      ...getRemovalConstraints(currentConfig),
    },
    specialOperations: getBuilderAiSpecialOperationGuidance(),
  });
  const projection = project(currentConfig);
  const componentProjection = serializeQuotedData(projection);
  if (
    projection.length > MAX_PROMPT_PROJECTED_COMPONENTS ||
    componentProjection.length > MAX_PROMPT_PROJECTION_CHARS ||
    new TextEncoder().encode(componentProjection).length >
      MAX_PROMPT_PROJECTION_CHARS
  ) {
    throw new BuilderAiPromptProjectionTooLargeError();
  }
  return [
    'Return JSON only; never return a full config, Markdown, code, or explanations.',
    'For a supported request use exactly the top-level shape {"status":"proposed","summary":"...","operations":[...]}.',
    'For unsupported executable code, HTML, script, or payment requests use exactly {"status":"refused","reason":"...","operations":[]}.',
    'Preserve unspecified content. Use only listed ids, types, and safe properties.',
    `<operation-guide>${operationGuidance}</operation-guide>`,
    `<safe-components>${componentProjection}</safe-components>`,
    `<merchant-request>${serializeQuotedData(clean(prompt))}</merchant-request>`,
  ].join('\n');
}
