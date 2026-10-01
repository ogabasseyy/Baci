import type { BuilderData } from './builder-ai-edit';
import { builderDesignCapabilityAdapter } from './builder-design-capability-adapter';
import { isReviewedPreviewRenderProp } from './builder-preview-render-policy-props';
import { previewRenderProjection } from './builder-preview-render-projection';
import { previewSafeLinks } from './builder-preview-safe-links';

const MAX_CAROUSEL_SLIDES = 5;
const componentIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const componentSlotZoneKeyPattern =
  /^([A-Za-z0-9][A-Za-z0-9_-]{0,119}):([A-Za-z][A-Za-z0-9_-]{0,79})$/;

type PreviewComponentIdentity = { id: string; type: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPuckComponentIdentity(
  value: unknown
): PreviewComponentIdentity | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== 'props' && key !== 'type')
  )
    return;
  const type = value.type;
  if (typeof type !== 'string' || !isRecord(value.props)) return;
  const id = value.props.id;
  if (typeof id !== 'string' || !componentIdPattern.test(id)) return;
  if (type === 'Flex')
    return Object.keys(value.props).every((key) => key === 'id')
      ? { id, type }
      : undefined;
  const capability = builderDesignCapabilityAdapter.getCapability(type);
  if (!capability?.renderable) return;
  if (capability.refused) return { id, type };
  return Object.entries(value.props).every(
    ([property, propValue]) =>
      property === 'id' ||
      isReviewedPreviewRenderProp(type, property, propValue)
  )
    ? { id, type }
    : undefined;
}

function parsePuckZoneKey(
  value: string
): { parentId: string; slot: string } | undefined {
  const match = componentSlotZoneKeyPattern.exec(value);
  return match ? { parentId: match[1], slot: match[2] } : undefined;
}

function allowsPuckZoneSlot(type: string, slot: string): boolean {
  return type === 'Flex' && slot === 'children';
}

function boundPreviewCarouselSlides(
  component: BuilderData['content'][number]
): BuilderData['content'][number] {
  if (
    component.type !== 'HeroCarousel' ||
    !Array.isArray(component.props.slides)
  )
    return component;
  return {
    ...component,
    props: {
      ...component.props,
      slides: component.props.slides.slice(0, MAX_CAROUSEL_SLIDES),
    },
  };
}

function boundPreviewCollection(
  collection: BuilderData['content']
): BuilderData['content'] {
  return collection.map(boundPreviewCarouselSlides);
}

function isPreviewCollection(value: unknown): value is BuilderData['content'] {
  return Array.isArray(value);
}

function boundPreviewCandidate(value: BuilderData): BuilderData {
  const zones = value.zones;
  return {
    ...value,
    content: boundPreviewCollection(value.content),
    ...(zones === undefined
      ? {}
      : {
          zones: Object.fromEntries(
            Object.entries(zones).map(([key, collection]) => [
              key,
              isPreviewCollection(collection)
                ? boundPreviewCollection(collection)
                : collection,
            ])
          ),
        }),
  };
}

function projectPreviewCandidate(value: BuilderData): BuilderData {
  return previewRenderProjection.projectCandidate(boundPreviewCandidate(value));
}

export const previewRenderPolicy = {
  allowsPuckZoneSlot,
  getPuckComponentIdentity,
  isPuckComponent: (value: unknown, componentIds: Set<string>) => {
    const identity = getPuckComponentIdentity(value);
    if (!identity || componentIds.has(identity.id)) return false;
    componentIds.add(identity.id);
    return true;
  },
  isPuckZoneKey: (value: string) => parsePuckZoneKey(value) !== undefined,
  isLegacyZoneKey: previewSafeLinks.isLegacyZoneKey,
  parsePuckZoneKey,
  projectPreviewCandidate,
};
