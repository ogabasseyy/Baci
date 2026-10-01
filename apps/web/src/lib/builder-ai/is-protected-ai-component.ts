import { getAiComponentDefinition } from './get-ai-component-definition';
import { isAiEditableComponent } from './is-ai-editable-component';

export function isProtectedAiComponent(componentType: string): boolean {
  return (
    isAiEditableComponent(componentType) &&
    getAiComponentDefinition(componentType).protected === true
  );
}
