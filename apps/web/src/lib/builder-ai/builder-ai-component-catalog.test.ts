import { render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { builderConfig } from '@/components/builder/config';
import * as catalog from './builder-ai-component-catalog';
import { getBuilderAiCatalogProjection } from './builder-ai-component-catalog-projection';
import { aiEditableComponents } from './builder-ai-component-definitions';
import { createInsertableComponentProps } from './builder-ai-component-insertable-props';
import {
  getBuilderAiPropShape,
  isBuilderAiPropValue,
} from './builder-ai-component-prop-validation';
import { isAiEditableComponent } from './is-ai-editable-component';

describe('builder AI component catalog', () => {
  it('keeps the catalog facade compatible with the focused utilities', () => {
    expect(catalog.aiEditableComponents).toBe(aiEditableComponents);
    expect(catalog.getBuilderAiCatalogProjection).toBe(
      getBuilderAiCatalogProjection
    );
    expect(catalog.getBuilderAiPropShape).toBe(getBuilderAiPropShape);
    expect(catalog.isBuilderAiPropValue).toBe(isBuilderAiPropValue);
    expect(catalog.createInsertableComponentProps).toBe(
      createInsertableComponentProps
    );
  });

  it('keeps every allowlisted component backed by the real Puck config', () => {
    for (const componentType of Object.keys(aiEditableComponents)) {
      expect(builderConfig.components).toHaveProperty(componentType);
      expect(isAiEditableComponent(componentType)).toBe(true);
    }
    expect(isAiEditableComponent('CodeEmbed')).toBe(false);
  });

  it('keeps every editable property aligned with a real Puck field', () => {
    for (const [componentType, definition] of Object.entries(
      aiEditableComponents
    )) {
      const component =
        builderConfig.components[
          componentType as keyof typeof builderConfig.components
        ];
      const fields = component.fields as Record<string, unknown>;

      for (const property of definition.editableProps) {
        expect(fields).toHaveProperty(property);
      }
    }
  });

  it('matches Puck field option values and numeric constraints exactly', () => {
    const fields = builderConfig.components;
    const optionValues = (component: keyof typeof fields, property: string) =>
      (
        (
          fields[component].fields as Record<
            string,
            { options?: { value: unknown }[] }
          >
        )[property]?.options ?? []
      ).map((option) => option.value);
    const numericLimits = (component: keyof typeof fields, property: string) =>
      (
        fields[component].fields as Record<
          string,
          { max?: number; min?: number }
        >
      )[property];

    expect(optionValues('Header', 'layout')).toEqual([
      'logo-left-nav-center',
      'logo-left-nav-right',
      'logo-center',
    ]);
    expect(optionValues('Header', 'paddingY')).toEqual(['sm', 'md', 'lg']);
    expect(optionValues('Header', 'searchRadius')).toEqual([
      'none',
      'sm',
      'md',
      'full',
    ]);
    expect(optionValues('Header', 'searchStyle')).toEqual([
      'outline',
      'filled',
      'minimal',
    ]);
    expect(optionValues('Features', 'columns')).toEqual([2, 3, 4]);
    expect(numericLimits('ProductGrid', 'columns')).toMatchObject({
      max: 4,
      min: 2,
    });
    expect(numericLimits('ProductGrid', 'limit')).toMatchObject({
      max: 24,
      min: 1,
    });
    expect(numericLimits('Testimonial', 'rating')).toMatchObject({
      max: 5,
      min: 0,
    });

    for (const value of optionValues('Header', 'layout')) {
      expect(isBuilderAiPropValue('Header', 'layout', value)).toBe(true);
    }
    for (const value of optionValues('Header', 'paddingY')) {
      expect(isBuilderAiPropValue('Header', 'paddingY', value)).toBe(true);
    }
    for (const value of optionValues('Header', 'searchRadius')) {
      expect(isBuilderAiPropValue('Header', 'searchRadius', value)).toBe(true);
    }
    for (const value of optionValues('Header', 'searchStyle')) {
      expect(isBuilderAiPropValue('Header', 'searchStyle', value)).toBe(true);
    }
    for (const value of optionValues('Features', 'columns')) {
      expect(isBuilderAiPropValue('Features', 'columns', value)).toBe(true);
    }
    expect(isBuilderAiPropValue('Features', 'columns', 1)).toBe(false);
    expect(isBuilderAiPropValue('ProductGrid', 'columns', 2.5)).toBe(false);
    expect(isBuilderAiPropValue('ProductGrid', 'limit', 2.5)).toBe(false);
    expect(isBuilderAiPropValue('Testimonial', 'rating', 2.5)).toBe(false);
  });

  it('uses safe insertion defaults and never takes a model supplied id', () => {
    expect(
      createInsertableComponentProps('Hero', {
        id: 'model-picked',
        title: 'Hi',
      })
    ).toMatchObject({ headingLevel: 'h2', title: 'Hi' });
    expect(
      createInsertableComponentProps('Hero', { id: 'model-picked' })
    ).not.toHaveProperty('id');
  });

  it('renders an inserted Testimonial with a neutral zero-star rating', () => {
    const testimonial = createInsertableComponentProps('Testimonial', {});
    const newsletter = createInsertableComponentProps('Newsletter', {});
    const renderTestimonial = builderConfig.components.Testimonial.render as (
      props: Record<string, unknown>
    ) => ReactNode;

    render(createElement('div', {}, renderTestimonial(testimonial)));

    expect(testimonial.rating).toBe(0);
    expect(
      screen.getByRole('img', { name: 'Rating: 0 out of 5 stars' })
    ).toBeInTheDocument();
    expect(JSON.stringify(newsletter)).not.toMatch(/offers?/i);
  });

  it('declares primitive and structured editable field shapes in one catalog', () => {
    expect(getBuilderAiPropShape('Hero', 'ctaLink')).toBe('url');
    expect(getBuilderAiPropShape('Header', 'ctaButton')).toBe('link');
    expect(getBuilderAiPropShape('Features', 'features')).toBe('feature-list');
    expect(getBuilderAiPropShape('Text', 'content')).toBe('primitive');
  });

  it('projects constrained values and limits so the model can produce valid patches', () => {
    const catalog = getBuilderAiCatalogProjection();
    const header = catalog.find(
      ({ componentType }) => componentType === 'Header'
    );
    const features = catalog.find(
      ({ componentType }) => componentType === 'Features'
    );

    expect(header?.editableProps).toContainEqual(
      expect.objectContaining({
        allowedValues: [
          'logo-left-nav-center',
          'logo-left-nav-right',
          'logo-center',
        ],
        name: 'layout',
      })
    );
    expect(features?.editableProps).toContainEqual(
      expect.objectContaining({ maximum: 4, minimum: 2, name: 'columns' })
    );
  });

  it('projects nested field members when current component values are empty', () => {
    const catalog = getBuilderAiCatalogProjection();
    const header = catalog.find(
      ({ componentType }) => componentType === 'Header'
    );
    const features = catalog.find(
      ({ componentType }) => componentType === 'Features'
    );

    expect(header?.editableProps).toContainEqual(
      expect.objectContaining({
        maximumItems: 8,
        members: [
          {
            maximumLength: 120,
            name: 'label',
            required: true,
            valueType: 'string',
          },
          {
            maximumLength: 512,
            name: 'url',
            required: true,
            valueType: 'safe-storefront-url',
          },
        ],
        name: 'navigationLinks',
      })
    );
    expect(header?.editableProps).toContainEqual(
      expect.objectContaining({
        members: [
          { name: 'show', required: true, valueType: 'boolean' },
          {
            maximumLength: 120,
            name: 'text',
            required: true,
            valueType: 'string',
          },
          {
            maximumLength: 512,
            name: 'url',
            required: true,
            valueType: 'safe-storefront-url',
          },
        ],
        name: 'ctaButton',
      })
    );
    expect(features?.editableProps).toContainEqual(
      expect.objectContaining({
        maximumItems: 8,
        members: expect.arrayContaining([
          expect.objectContaining({ name: 'description', required: true }),
          expect.objectContaining({
            allowedValues: expect.arrayContaining(['check', 'truck']),
            name: 'icon',
          }),
          expect.objectContaining({ name: 'title', required: true }),
        ]),
        minimumItems: 1,
        name: 'features',
      })
    );
  });
});
