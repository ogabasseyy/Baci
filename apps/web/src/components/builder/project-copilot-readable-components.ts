import { builderDesignCapabilityAdapter } from '@baci/shared/contracts';
import type { Data } from '@puckeditor/core';

const MAX_CAROUSEL_SLIDES = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function projectCarouselSlides(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const specialOperation = 'updateCarouselSlide';
  const specialProps =
    builderDesignCapabilityAdapter.getSpecialProps(
      'HeroCarousel',
      specialOperation
    ) ?? {};
  return value.slice(0, MAX_CAROUSEL_SLIDES).map((slide, slideIndex) => {
    if (!isRecord(slide)) return { slideIndex };
    const projected = Object.fromEntries(
      Object.entries(specialProps).flatMap(([property]) => {
        const candidate = slide[property];
        return builderDesignCapabilityAdapter.isSpecialPropValue(
          'HeroCarousel',
          specialOperation,
          property,
          candidate
        )
          ? [[property, candidate]]
          : [];
      })
    );
    return { slideIndex, ...projected };
  });
}

function projectEditableProps(
  componentType: string,
  props: Record<string, unknown>
): Record<string, unknown> {
  const capability =
    builderDesignCapabilityAdapter.getCapability(componentType);
  if (!capability?.aiEditable) return {};

  const projected = Object.fromEntries(
    Object.entries(capability.props).flatMap(([property]) => {
      const candidate = props[property];
      return builderDesignCapabilityAdapter.isPropValue(
        componentType,
        property,
        candidate
      )
        ? [[property, candidate]]
        : [];
    })
  );
  if (componentType === 'HeroCarousel') {
    const slides = projectCarouselSlides(props.slides);
    if (slides !== undefined) projected.slides = slides;
  }
  return projected;
}

export function projectCopilotReadableComponents(content: Data['content']) {
  return content.map((component, index) => {
    const props = isRecord(component.props) ? component.props : {};
    return {
      id: typeof props.id === 'string' ? props.id : undefined,
      index,
      props: projectEditableProps(component.type, props),
      type: component.type,
    };
  });
}
