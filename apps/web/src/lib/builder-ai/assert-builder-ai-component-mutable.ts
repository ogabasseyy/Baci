import {
  isAiEditableComponent,
  isProtectedAiComponent,
} from './builder-ai-component-catalog';
import type { BuilderAiComponent } from './get-builder-ai-content-collections';

export function assertBuilderAiComponentMutable(
  component: BuilderAiComponent,
  ErrorConstructor: new (message: string) => Error
): void {
  if (
    !isAiEditableComponent(component.type) ||
    isProtectedAiComponent(component.type)
  ) {
    throw new ErrorConstructor('Component is protected or unsupported');
  }
}
