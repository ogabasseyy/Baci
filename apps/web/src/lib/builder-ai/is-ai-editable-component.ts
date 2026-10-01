import { builderDesignCapabilities } from '@baci/shared/contracts';
import {
  type AiEditableComponentType,
  aiEditableComponents,
} from './builder-ai-component-definitions';

export function isAiEditableComponent(
  componentType: string
): componentType is AiEditableComponentType {
  return (
    Object.hasOwn(aiEditableComponents, componentType) &&
    builderDesignCapabilities.components.some(
      (capability) =>
        capability.componentType === componentType && capability.aiEditable
    )
  );
}
