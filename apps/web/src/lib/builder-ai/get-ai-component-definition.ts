import {
  type AiEditableComponentType,
  aiEditableComponents,
  type ComponentDefinition,
} from './builder-ai-component-definitions';

export function getAiComponentDefinition(
  componentType: AiEditableComponentType
): ComponentDefinition {
  return aiEditableComponents[componentType];
}
