import type { BuilderData } from './builder-ai-edit';
import { builderDesignCapabilityAdapter } from './builder-design-capability-adapter';

const PREVIEW_CAROUSEL_IMAGE = '/placeholder.png';
const assetPathPattern =
  /^\/(?:[A-Za-z0-9._~!$&*+,=@%-]{1,160}|(?:_next\/static|assets|avatars|images|media|uploads)\/[A-Za-z0-9._~!$&*+,=@%/-]{1,440})\.(?:avif|gif|jpe?g|png|svg|webp)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPreviewAssetPath(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const decodedPath = decodeURIComponent(value);
    if (
      decodedPath
        .split('/')
        .some((segment) => segment === '.' || segment === '..')
    ) {
      return false;
    }
  } catch {
    return false;
  }
  return assetPathPattern.test(value);
}

function isPreviewHttpsAsset(value: unknown): boolean {
  if (
    typeof value !== 'string' ||
    value.length > 2_048 ||
    /[\\\s"'()]/.test(value)
  )
    return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.length > 0 &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    );
  } catch {
    return false;
  }
}

function isPreviewAssetSource(value: unknown): boolean {
  return isPreviewAssetPath(value) || isPreviewHttpsAsset(value);
}

function projectPreviewComponent(
  component: BuilderData['content'][number]
): BuilderData['content'][number] | undefined {
  if (builderDesignCapabilityAdapter.getCapability(component.type)?.refused)
    return {
      props: {
        id: component.props.id,
        label: `${component.type} section`,
      },
      type: 'PreviewPlaceholder',
    };
  if (
    component.type === 'HeroCarousel' &&
    Array.isArray(component.props.slides)
  ) {
    return {
      ...component,
      props: {
        ...component.props,
        slides: component.props.slides.map((slide) => {
          if (!isRecord(slide)) return slide;
          const { image: _image, ...reviewed } = slide;
          return { ...reviewed, image: PREVIEW_CAROUSEL_IMAGE };
        }),
      },
    };
  }
  const assetProperties =
    component.type === 'Header'
      ? ['logoUrl', 'backgroundImage']
      : component.type === 'Hero'
        ? ['backgroundImage']
        : component.type === 'Testimonial'
          ? ['avatar']
          : [];
  return assetProperties.length === 0
    ? component
    : {
        ...component,
        props: Object.fromEntries(
          Object.entries(component.props).filter(
            ([property, value]) =>
              !assetProperties.includes(property) || isPreviewAssetPath(value)
          )
        ),
      };
}

function projectPreviewCollection(collection: BuilderData['content']) {
  return collection.flatMap((component) => {
    const projected = projectPreviewComponent(component);
    return projected === undefined ? [] : [projected];
  });
}

function projectPreviewCandidate(value: BuilderData): BuilderData {
  const zones = value.zones;
  return {
    ...value,
    content: projectPreviewCollection(value.content),
    ...(zones === undefined
      ? {}
      : {
          zones: Object.fromEntries(
            Object.entries(zones).map(([key, collection]) => [
              key,
              Array.isArray(collection)
                ? projectPreviewCollection(collection)
                : collection,
            ])
          ),
        }),
  };
}

export const previewRenderProjection = {
  isAssetSource: isPreviewAssetSource,
  projectCandidate: projectPreviewCandidate,
};
