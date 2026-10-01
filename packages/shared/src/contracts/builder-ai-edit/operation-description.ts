import type { BuilderAiModelOperation } from './model-plan';

function componentName(operation: BuilderAiModelOperation): string {
  if (operation.kind === 'update_component')
    return operation.patch.componentType;
  if (operation.kind === 'insert_component')
    return operation.initialContent.componentType;
  if (operation.kind === 'update_carousel_slide') return 'Hero Carousel';
  return 'component';
}

function safeTargetComponentType(componentType?: string): string {
  return [
    'Header',
    'Hero',
    'HeroCarousel',
    'Text',
    'Features',
    'ProductGrid',
    'Testimonial',
    'Newsletter',
    'Footer',
  ].includes(componentType ?? '')
    ? (componentType as string)
    : 'component';
}

export function describeBuilderAiOperation(
  operation: BuilderAiModelOperation,
  targetComponentType?: string
): string {
  switch (operation.kind) {
    case 'update_component':
      return `Update ${componentName(operation)} text`;
    case 'update_carousel_slide':
      return 'Update Hero Carousel text';
    case 'insert_component':
      return `Add ${componentName(operation)}`;
    case 'remove_component':
      return `Remove ${safeTargetComponentType(targetComponentType)}`;
    case 'move_component':
      return `Move ${safeTargetComponentType(targetComponentType)}`;
    case 'update_theme':
      return operation.preset
        ? `Apply ${operation.preset.charAt(0).toUpperCase()}${operation.preset.slice(1)} theme`
        : 'Update theme colors';
    case 'update_root':
      return 'Update page title';
  }
}
