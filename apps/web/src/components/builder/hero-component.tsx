import type { ReactElement } from 'react';
import { HeroPresentation } from '@/components/storefront/portable/hero-presentation';
import { ThemedButton } from '@/components/themed/themed-button';
import { AnimatedWrapper, type AnimationType } from './animated-wrapper';
import { ImagePickerField } from './fields/image-picker-field';
import { ScopedStorefrontLink } from './scoped-storefront-link';

export type HeroProps = {
  title: string;
  subtitle: string;
  ctaText: string;
  ctaLink: string;
  align: 'left' | 'center' | 'right';
  padding: 'small' | 'medium' | 'large';
  backgroundImage?: string;
  backgroundGradient?: string;
  overlay?: boolean;
  animationType?: string;
  animationDuration?: string;
  animationDelay?: number;
  animationTrigger?: string;
  headingLevel?: 'h1' | 'h2' | 'div';
};

const mapAnimationType = (type: string | undefined): AnimationType => {
  const map: Record<string, AnimationType> = {
    fade: 'fade-in',
    'fade-in': 'fade-in',
    'slide-up': 'slide-up',
    'slide-down': 'slide-down',
    'slide-left': 'slide-left',
    'slide-right': 'slide-right',
    zoom: 'zoom-in',
    'zoom-in': 'zoom-in',
    'scale-up': 'scale-up',
    none: 'none',
  };
  return map[type ?? 'none'] ?? 'none';
};

const mapAnimationDuration = (
  duration: string | undefined
): 'fast' | 'normal' | 'slow' => {
  if (duration === 'fast' || duration === 'slow' || duration === 'normal')
    return duration;
  return 'normal';
};

const mapAnimationTrigger = (
  trigger: string | undefined
): 'immediate' | 'scroll' => {
  if (trigger === 'immediate' || trigger === 'onload') return 'immediate';
  return 'scroll';
};

const animationFields = {
  animationType: {
    type: 'select' as const,
    label: 'Animation',
    options: [
      { label: 'None', value: 'none' },
      { label: 'Fade In', value: 'fade-in' },
      { label: 'Slide Up', value: 'slide-up' },
      { label: 'Slide Down', value: 'slide-down' },
      { label: 'Slide Left', value: 'slide-left' },
      { label: 'Slide Right', value: 'slide-right' },
      { label: 'Zoom In', value: 'zoom-in' },
      { label: 'Scale Up', value: 'scale-up' },
    ],
  },
  animationDuration: {
    type: 'select' as const,
    label: 'Animation Speed',
    options: [
      { label: 'Fast', value: 'fast' },
      { label: 'Normal', value: 'normal' },
      { label: 'Slow', value: 'slow' },
    ],
  },
  animationDelay: {
    type: 'number' as const,
    label: 'Animation Delay (seconds)',
    min: 0,
    max: 5,
    step: 0.1,
  },
  animationTrigger: {
    type: 'select' as const,
    label: 'Animation Trigger',
    options: [
      { label: 'On Page Load', value: 'immediate' },
      { label: 'On Scroll Into View', value: 'scroll' },
    ],
  },
};

function renderHero({
  title,
  subtitle,
  ctaText,
  ctaLink,
  align,
  padding,
  backgroundImage,
  backgroundGradient,
  overlay,
  headingLevel,
  animationType,
  animationDuration,
  animationDelay,
  animationTrigger,
}: HeroProps): ReactElement {
  return (
    <AnimatedWrapper
      animation={{
        type: mapAnimationType(animationType),
        duration: mapAnimationDuration(animationDuration),
        delay: animationDelay,
        trigger: mapAnimationTrigger(animationTrigger),
      }}
    >
      <HeroPresentation
        title={title}
        subtitle={subtitle}
        align={align}
        padding={padding}
        backgroundImage={backgroundImage}
        backgroundGradient={backgroundGradient}
        overlay={overlay}
        headingLevel={headingLevel}
        action={
          <ThemedButton colorRole="primary" size="lg" asChild>
            <ScopedStorefrontLink href={ctaLink}>
              {ctaText}
            </ScopedStorefrontLink>
          </ThemedButton>
        }
      />
    </AnimatedWrapper>
  );
}

export const heroComponent = {
  label: 'Hero Section',
  permissions: { delete: true, duplicate: true },
  fields: {
    title: { type: 'text', inline: true, contentEditable: true },
    subtitle: { type: 'textarea', inline: true, contentEditable: true },
    ctaText: { type: 'text', inline: true, contentEditable: true },
    ctaLink: { type: 'text' },
    backgroundImage: {
      type: 'custom',
      label: 'Background Image (optional)',
      render: ({
        field,
        onChange,
        value,
      }: {
        field: { label?: string };
        onChange: (value: string | undefined) => void;
        value: string | undefined;
      }) => (
        <ImagePickerField
          field={field}
          onChange={onChange}
          value={value ?? ''}
        />
      ),
    },
    overlay: {
      type: 'radio',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    align: {
      type: 'select',
      options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
      ],
    },
    padding: {
      type: 'select',
      options: [
        { label: 'Small', value: 'small' },
        { label: 'Medium', value: 'medium' },
        { label: 'Large', value: 'large' },
      ],
    },
    headingLevel: {
      type: 'select',
      label: 'Heading Level (SEO)',
      options: [
        { label: 'H1 (Main Title)', value: 'h1' },
        { label: 'H2 (Section Title)', value: 'h2' },
        { label: 'Div (Decoration)', value: 'div' },
      ],
    },
    ...animationFields,
  } as const,
  defaultProps: {
    title: 'Welcome to Our Store',
    subtitle: 'Discover our amazing collection of products.',
    ctaText: 'Shop Now',
    ctaLink: '/products',
    align: 'center',
    padding: 'medium',
    overlay: false,
    headingLevel: 'h1',
    animationType: 'fade-in',
    animationDuration: 'normal',
    animationDelay: 0,
    animationTrigger: 'scroll',
  } as const,
  render: renderHero,
};
