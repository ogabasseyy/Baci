import type {
  BuilderDesignCapability,
  BuilderDesignPlacement,
  BuilderDesignProp,
  BuilderDesignProps,
} from './builder-design-capability-types';

export const label = (defaultValue?: string): BuilderDesignProp => ({
  ...(defaultValue === undefined ? {} : { default: defaultValue }),
  maximumLength: 120,
  type: 'string',
});

export const copy = (defaultValue?: string): BuilderDesignProp => ({
  ...(defaultValue === undefined ? {} : { default: defaultValue }),
  maximumLength: 2000,
  type: 'string',
});

export const safeLink: BuilderDesignProp = {
  maximumLength: 512,
  type: 'safe-link',
};

export const fixedPlacement: BuilderDesignPlacement = {
  allowedCollections: [],
  kind: 'fixed',
};

export const contentPlacement: BuilderDesignPlacement = {
  allowedCollections: ['content', 'zones'],
  kind: 'content',
};

export const allow = (
  componentType: string,
  description: string,
  props: BuilderDesignProps,
  aiInsertable = true,
  protectedComponent = false,
  placement: BuilderDesignPlacement = contentPlacement
): BuilderDesignCapability => ({
  aiEditable: true,
  aiInsertable,
  componentType,
  description,
  placement,
  protected: protectedComponent,
  props,
  refused: false,
  renderable: true,
  responsiveProps: [],
});

export const deny = (
  componentType: string,
  description: string,
  code: string,
  message: string
): BuilderDesignCapability => ({
  aiEditable: false,
  aiInsertable: false,
  componentType,
  description,
  placement: fixedPlacement,
  protected: true,
  props: {},
  refused: true,
  refusal: { code, message },
  renderable: true,
  responsiveProps: [],
});
