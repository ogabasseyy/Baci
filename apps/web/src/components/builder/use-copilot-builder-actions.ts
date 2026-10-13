'use client';

import { builderDesignCapabilities } from '@baci/shared/contracts';
import { useCopilotAction, useCopilotReadable } from '@copilotkit/react-core';
import type { Data } from '@puckeditor/core';
import { areBuilderAiPropValuesEqual } from '@/lib/builder-ai/are-builder-ai-prop-values-equal';
import { createInsertableComponentProps } from '@/lib/builder-ai/builder-ai-component-catalog';
import { hasDuplicateCarouselSlideTitle } from '@/lib/builder-ai/has-duplicate-carousel-slide-title';
import { sanitizeBuilderAiProps } from '@/lib/builder-ai/sanitize-builder-ai-props';
import { COMPONENT_SCHEMA } from './component-schema';
import { projectCopilotReadableComponents } from './project-copilot-readable-components';

const aiInsertableComponentTypes = builderDesignCapabilities.components
  .filter(({ aiInsertable }) => aiInsertable)
  .map(({ componentType }) => componentType);
const aiInsertableComponentTypeSet = new Set(aiInsertableComponentTypes);
const aiInsertableComponentSchema = Object.fromEntries(
  Object.entries(COMPONENT_SCHEMA).filter(([componentType]) =>
    aiInsertableComponentTypeSet.has(componentType)
  )
);

interface UseCopilotBuilderActionsProps {
  data: Data;
  setData: (data: Data) => void;
}

function findCapability(componentType: string) {
  return builderDesignCapabilities.components.find(
    (capability) => capability.componentType === componentType
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseProps(value: string | undefined): Record<string, unknown> | null {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function createUniqueComponentId(
  componentType: string,
  content: Data['content']
) {
  const base = `${componentType}-${Date.now()}`;
  const ids = new Set(
    content.flatMap((component) =>
      typeof component.props.id === 'string' ? [component.props.id] : []
    )
  );
  let id = base;
  let suffix = 1;
  while (ids.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

/**
 * Hook to register CopilotKit actions for the builder.
 * Allows AI to add, remove, and modify components with specific props.
 */
export function useCopilotBuilderActions({
  data,
  setData,
}: UseCopilotBuilderActionsProps) {
  // Make current config and available tools readable by AI
  useCopilotReadable({
    description:
      'The current storefront page configuration. You can modify this using actions.',
    value: JSON.stringify({
      availableComponents: aiInsertableComponentSchema,
      editableComponents: COMPONENT_SCHEMA,
      currentComponents: projectCopilotReadableComponents(data.content ?? []),
    }),
  });

  // Action: Add a component with specific props
  useCopilotAction({
    name: 'addComponent',
    description: `Add a new component to the page. Available types: ${aiInsertableComponentTypes.join(', ')}.`,
    parameters: [
      {
        name: 'componentType',
        type: 'string',
        description: 'The type of component to add.',
        required: true,
      },
      {
        name: 'position',
        type: 'number',
        description: 'Index to insert at (0 = top). Default is bottom (-1).',
        required: false,
      },
      {
        name: 'props',
        type: 'string', // Copilot handles complex objects better as JSON strings sometimes, but we'll try object first in next iteration if needed.
        description:
          'JSON string of props to initialize the component with (e.g., title, subtitle). Refer to availableComponents schema.',
        required: false,
      },
    ],
    handler: ({ componentType, position = -1, props }) => {
      const capability = findCapability(componentType);
      if (!capability) return `Invalid component type: ${componentType}.`;
      if (!capability.aiInsertable) {
        return `Component type is not insertable: ${componentType}.`;
      }

      const parsedProps = parseProps(props);
      if (!parsedProps) return 'Failed to parse props JSON.';
      const sanitized = sanitizeBuilderAiProps(componentType, parsedProps);
      const newContent = [...(data.content || [])];

      const newComponent = {
        type: componentType,
        props: {
          ...createInsertableComponentProps(componentType, sanitized.props),
          id: createUniqueComponentId(componentType, newContent),
        },
      };

      if (position === -1 || position >= newContent.length) {
        newContent.push(newComponent);
      } else {
        newContent.splice(Math.max(0, position), 0, newComponent);
      }

      setData({ ...data, content: newContent });
      return [
        ...sanitized.warnings,
        `Added ${componentType} at position ${position === -1 ? 'bottom' : position}.`,
      ].join(' ');
    },
  });

  // Action: Update an existing component
  useCopilotAction({
    name: 'updateComponent',
    description:
      'Update an editable component using its editableComponents schema. For HeroCarousel, include slideIndex and the special-operation slide fields in updates.',
    parameters: [
      {
        name: 'index',
        type: 'number',
        description: 'The index of the component to update (0-based).',
        required: true,
      },
      {
        name: 'updates',
        type: 'string',
        description:
          'JSON string of properties to update (e.g., {"title": "New Title"}).',
        required: true,
      },
    ],
    handler: ({ index, updates }) => {
      const newContent = [...(data.content || [])];

      if (!Number.isInteger(index) || index < 0 || index >= newContent.length) {
        return `Invalid index: ${index}. Component not found.`;
      }
      if (!findCapability(newContent[index].type)?.aiEditable) {
        return `Component type is not editable: ${newContent[index].type}.`;
      }

      const parsedUpdates = parseProps(updates);
      if (!parsedUpdates) return 'Failed to parse updates JSON.';
      if (newContent[index].type === 'HeroCarousel') {
        const slideIndex = parsedUpdates.slideIndex;
        const slides = newContent[index].props.slides;
        if (
          typeof slideIndex !== 'number' ||
          !Number.isInteger(slideIndex) ||
          slideIndex > 4 ||
          !Array.isArray(slides) ||
          !isRecord(slides[slideIndex])
        ) {
          return 'Invalid carousel slide index.';
        }
        const patch = Object.fromEntries(
          Object.entries(parsedUpdates).filter(([key]) => key !== 'slideIndex')
        );
        const sanitizedSlide = sanitizeBuilderAiProps(
          'HeroCarousel',
          patch,
          'updateCarouselSlide'
        );
        const nextTitle = sanitizedSlide.props.title;
        if (hasDuplicateCarouselSlideTitle(slides, slideIndex, nextTitle)) {
          return 'Carousel slide title must be unique.';
        }
        if (Object.keys(sanitizedSlide.props).length === 0) {
          return [
            ...sanitizedSlide.warnings,
            'No safe changes for HeroCarousel.',
          ].join(' ');
        }
        newContent[index] = {
          ...newContent[index],
          props: {
            ...newContent[index].props,
            slides: slides.map((slide, candidateIndex) =>
              candidateIndex === slideIndex
                ? { ...slide, ...sanitizedSlide.props }
                : slide
            ),
          },
        };
        setData({ ...data, content: newContent });
        return [
          ...sanitizedSlide.warnings,
          `Updated carousel slide ${slideIndex}.`,
        ].join(' ');
      }
      const sanitized = sanitizeBuilderAiProps(
        newContent[index].type,
        parsedUpdates
      );
      if (Object.keys(sanitized.props).length === 0) {
        return [
          ...sanitized.warnings,
          `No safe changes for ${newContent[index].type}.`,
        ].join(' ');
      }
      if (
        !Object.entries(sanitized.props).some(
          ([key, value]) =>
            !areBuilderAiPropValuesEqual(newContent[index].props[key], value)
        )
      ) {
        return [
          ...sanitized.warnings,
          `No safe changes for ${newContent[index].type}.`,
        ].join(' ');
      }

      newContent[index] = {
        ...newContent[index],
        props: {
          ...newContent[index].props,
          ...sanitized.props,
        },
      };

      setData({ ...data, content: newContent });
      return [
        ...sanitized.warnings,
        `Updated component at index ${index}.`,
      ].join(' ');
    },
  });

  // Action: Remove a component
  useCopilotAction({
    name: 'removeComponent',
    description: 'Remove a component from the page.',
    parameters: [
      {
        name: 'index',
        type: 'number',
        description: 'The index of the component to remove.',
        required: true,
      },
    ],
    handler: ({ index }) => {
      const newContent = [...(data.content || [])];
      if (Number.isInteger(index) && index >= 0 && index < newContent.length) {
        const target = newContent[index];
        const capability = findCapability(target.type);
        if (!capability?.aiEditable || capability.protected) {
          return `Component type is not removable: ${target.type}.`;
        }
        const removed = newContent.splice(index, 1)[0];
        setData({ ...data, content: newContent });
        return `Removed ${removed.type} at index ${index}.`;
      }
      return `Invalid index: ${index}`;
    },
  });
}
