import {
  type BuilderAiModelOperation,
  type BuilderAiProposedPlan,
  type BuilderData,
  builderAiEditContract,
} from '@baci/shared/contracts';
import {
  applyBuilderAiCarouselPatch,
  applyBuilderAiComponentPatch,
} from './apply-builder-ai-component-patches';
import { applyBuilderAiRootTitle } from './apply-builder-ai-root-title';
import { assertBuilderAiComponentMutable } from './assert-builder-ai-component-mutable';
import { assertBuilderAiUniqueIds } from './assert-builder-ai-unique-ids';
import {
  createInsertableComponentProps,
  isAiEditableComponent,
  isAiInsertableComponent,
} from './builder-ai-component-catalog';
import {
  getBuilderAiStructuralBaseline,
  getBuilderAiStructuralFailure,
} from './builder-ai-structure-guards';
import { applyBuilderAiTheme } from './builder-ai-theme-presets';
import { cloneBuilderAiConfig } from './clone-builder-ai-config';
import { createBuilderComponentId } from './create-builder-component-id';
import { findBuilderAiComponent } from './find-builder-ai-component';
import {
  type BuilderAiComponent,
  getBuilderAiContentCollections,
} from './get-builder-ai-content-collections';
import { getBuilderAiDestinationIndex } from './get-builder-ai-destination-index';
import { getBuilderAiFirstContentDestination } from './get-builder-ai-first-content-destination';
import { getBuilderAiInsertDestination } from './get-builder-ai-insert-destination';
import { getBuilderAiInsertOffset } from './get-builder-ai-insert-offset';
import { getBuilderAiRawPlanMediaWarning } from './get-builder-ai-raw-plan-media-warning';
import { getBuilderAiValidCandidate } from './get-builder-ai-valid-candidate';
import { getBuilderComponentId } from './get-builder-component-id';
import { isRenderedH1Hero } from './is-rendered-h1-hero';
import { normalizeBuilderAiModelPlan } from './normalize-builder-ai-model-plan';
import { pushBuilderAiWarnings } from './push-builder-ai-warnings';
import { resetBuilderAiInsertOffset } from './reset-builder-ai-insert-offset';
import { sanitizeBuilderAiProps } from './sanitize-builder-ai-props';
export class BuilderAiEditPlanError extends Error {}
export interface ApplyBuilderAiEditPlanResult {
  candidateConfig: BuilderData;
  warnings: string[];
}
function applyOperation(
  config: BuilderData,
  operation: BuilderAiModelOperation,
  createId: (componentType: string) => string,
  warnings: string[],
  insertOffsets: WeakMap<BuilderAiComponent[], Map<string, number>>
): void {
  switch (operation.kind) {
    case 'update_component': {
      const target = findBuilderAiComponent(config, operation.componentId);
      if (!target)
        throw new BuilderAiEditPlanError('Component target was not found');
      const component = target.content[target.index];
      if (
        !isAiEditableComponent(component.type) ||
        !isAiEditableComponent(operation.patch.componentType) ||
        component.type !== operation.patch.componentType
      ) {
        throw new BuilderAiEditPlanError(
          'Component type does not match target'
        );
      }
      pushBuilderAiWarnings(
        warnings,
        applyBuilderAiComponentPatch(component, operation.patch)
      );
      return;
    }
    case 'update_carousel_slide':
      pushBuilderAiWarnings(
        warnings,
        applyBuilderAiCarouselPatch(
          (() => {
            const target = findBuilderAiComponent(
              config,
              operation.componentId
            );
            if (!target) {
              throw new BuilderAiEditPlanError(
                'Component target was not found'
              );
            }
            return target.content[target.index];
          })(),
          operation,
          (message) => new BuilderAiEditPlanError(message)
        )
      );
      return;
    case 'insert_component': {
      const initial = operation.initialContent as Record<string, unknown>;
      const componentType = String(initial.componentType ?? '');
      if (!isAiInsertableComponent(componentType)) {
        throw new BuilderAiEditPlanError('Component cannot be inserted');
      }
      const id = createId(componentType);
      if (
        getBuilderAiContentCollections(config).some((items) =>
          items.some((component) => getBuilderComponentId(component) === id)
        )
      ) {
        throw new BuilderAiEditPlanError('Generated component id collides');
      }
      const sanitized = sanitizeBuilderAiProps(componentType, initial);
      if (sanitized.warnings.length > 0) {
        throw new BuilderAiEditPlanError('Insert contains unsupported fields');
      }
      const props = createInsertableComponentProps(
        componentType,
        sanitized.props
      );
      const destination = getBuilderAiInsertDestination(
        config,
        componentType,
        operation.placement,
        BuilderAiEditPlanError
      );
      const destinationContent = destination.content;
      const insertionIndex = getBuilderAiDestinationIndex(
        config,
        destinationContent,
        operation.placement,
        (message) => new BuilderAiEditPlanError(message)
      );
      const offset = getBuilderAiInsertOffset(
        insertOffsets,
        destinationContent,
        operation.placement
      );
      destinationContent.splice(insertionIndex + offset, 0, {
        props: { ...props, id },
        type: componentType,
      });
      return;
    }
    case 'remove_component': {
      const target = findBuilderAiComponent(config, operation.componentId);
      if (!target)
        throw new BuilderAiEditPlanError('Component target was not found');
      const component = target.content[target.index];
      assertBuilderAiComponentMutable(component, BuilderAiEditPlanError);
      if (
        isRenderedH1Hero(component) &&
        getBuilderAiContentCollections(config).flat().filter(isRenderedH1Hero)
          .length === 1
      ) {
        throw new BuilderAiEditPlanError('Cannot remove the final H1 Hero');
      }
      target.content.splice(target.index, 1);
      return;
    }
    case 'move_component': {
      const source = findBuilderAiComponent(config, operation.componentId);
      if (!source)
        throw new BuilderAiEditPlanError('Component target was not found');
      const component = source.content[source.index];
      assertBuilderAiComponentMutable(component, BuilderAiEditPlanError);
      const destinationTarget = findBuilderAiComponent(
        config,
        operation.destination.position === 'after'
          ? operation.destination.componentId
          : ''
      );
      const destinationContent =
        destinationTarget?.content ??
        (operation.destination.position === 'first_content'
          ? getBuilderAiFirstContentDestination(
              config,
              operation.destination.collection,
              BuilderAiEditPlanError
            )
          : source.content);
      let destination = getBuilderAiDestinationIndex(
        config,
        destinationContent,
        operation.destination,
        (message) => new BuilderAiEditPlanError(message)
      );
      if (source.content === destinationContent && source.index < destination)
        destination -= 1;
      if (
        source.content === destinationContent &&
        source.index === destination
      ) {
        pushBuilderAiWarnings(warnings, ['No safe changes for move.']);
        return;
      }
      resetBuilderAiInsertOffset(insertOffsets, source.content, {
        componentId: operation.componentId,
        position: 'after',
      });
      resetBuilderAiInsertOffset(
        insertOffsets,
        destinationContent,
        operation.destination
      );
      source.content.splice(source.index, 1);
      destinationContent.splice(destination, 0, component);
      return;
    }
    case 'update_root': {
      const updated = applyBuilderAiRootTitle(config.root, operation.title);
      if (!updated.changed) {
        pushBuilderAiWarnings(warnings, ['No safe changes for page title.']);
        return;
      }
      config.root = updated.root;
      return;
    }
    case 'update_theme': {
      const theme = applyBuilderAiTheme(config.theme, operation).theme;
      if (JSON.stringify(config.theme) === JSON.stringify(theme)) {
        pushBuilderAiWarnings(warnings, ['No safe changes for theme.']);
        return;
      }
      config.theme = theme;
      return;
    }
    default: {
      const _exhaustiveOperation: never = operation;
      throw new BuilderAiEditPlanError('Unsupported builder AI operation');
    }
  }
}
export function applyBuilderAiEditPlan(
  currentConfig: BuilderData,
  plan: BuilderAiProposedPlan,
  createId: (componentType: string) => string = createBuilderComponentId
): ApplyBuilderAiEditPlanResult {
  const candidateConfig = cloneBuilderAiConfig(
    currentConfig,
    BuilderAiEditPlanError
  );
  const baseline = getBuilderAiStructuralBaseline(candidateConfig);
  const rawMediaWarning = getBuilderAiRawPlanMediaWarning(plan);
  if (rawMediaWarning) {
    return {
      candidateConfig: getBuilderAiValidCandidate(
        candidateConfig,
        baseline,
        BuilderAiEditPlanError
      ),
      warnings: [rawMediaWarning],
    };
  }
  const parsedPlan = builderAiEditContract.modelPlanSchema.safeParse(
    normalizeBuilderAiModelPlan(plan)
  );
  if (!parsedPlan.success || parsedPlan.data.status !== 'proposed') {
    throw new BuilderAiEditPlanError('Invalid builder AI edit plan');
  }
  assertBuilderAiUniqueIds(candidateConfig, BuilderAiEditPlanError);
  const warnings: string[] = [];
  const insertOffsets = new WeakMap<
    BuilderAiComponent[],
    Map<string, number>
  >();
  for (const operation of parsedPlan.data.operations) {
    try {
      applyOperation(
        candidateConfig,
        operation,
        createId,
        warnings,
        insertOffsets
      );
    } catch (error) {
      if (error instanceof BuilderAiEditPlanError) throw error;
      throw new BuilderAiEditPlanError('Unable to apply builder AI edit plan');
    }
    assertBuilderAiUniqueIds(candidateConfig, BuilderAiEditPlanError);
    const structureFailure = getBuilderAiStructuralFailure(
      candidateConfig,
      baseline,
      false
    );
    if (structureFailure) throw new BuilderAiEditPlanError(structureFailure);
  }
  return {
    candidateConfig: getBuilderAiValidCandidate(
      candidateConfig,
      baseline,
      BuilderAiEditPlanError
    ),
    warnings,
  };
}
