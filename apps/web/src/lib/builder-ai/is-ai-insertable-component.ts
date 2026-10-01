import type { AiEditableComponentType } from './builder-ai-component-definitions';
import { getAiComponentDefinition } from './get-ai-component-definition';
import { isAiEditableComponent } from './is-ai-editable-component';

export function isAiInsertableComponent(
  componentType: string
): componentType is AiEditableComponentType {
  return (
    isAiEditableComponent(componentType) &&
    getAiComponentDefinition(componentType).insertable === true
  );
}
