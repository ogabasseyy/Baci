import { getAiComponentDefinition } from './get-ai-component-definition';
import { isAiInsertableComponent } from './is-ai-insertable-component';

export function createInsertableComponentProps(
  componentType: string,
  patch: Record<string, unknown>
): Record<string, unknown> {
  if (!isAiInsertableComponent(componentType)) {
    throw new Error(`Unsupported insertable component: ${componentType}`);
  }
  const definition = getAiComponentDefinition(componentType);
  const props = { ...definition.defaults };

  for (const property of definition.editableProps) {
    if (patch[property] !== undefined) props[property] = patch[property];
  }
  return props;
}
