export type BuilderDesignProp = {
  default?: unknown;
  enum?: string[];
  item?: BuilderDesignItem;
  maximum?: number;
  maximumItems?: number;
  maximumLength?: number;
  minimum?: number;
  minimumItems?: number;
  required?: boolean;
  type: string;
  wholeNumber?: boolean;
};

export type BuilderDesignProps = Record<string, BuilderDesignProp>;

export type BuilderDesignItem = {
  properties: BuilderDesignProps;
  uniqueBy?: string;
};

export type BuilderDesignPlacement = {
  allowedCollections: string[];
  kind: 'content' | 'fixed';
};

export type BuilderDesignCapability = {
  aiEditable: boolean;
  aiInsertable: boolean;
  componentType: string;
  description: string;
  initialProps?: Record<string, unknown>;
  placement: BuilderDesignPlacement;
  protected: boolean;
  props: BuilderDesignProps;
  refused: boolean;
  refusal?: { code: string; message: string };
  renderable: boolean;
  responsiveProps: string[];
  specialOperations?: Record<string, BuilderDesignProps>;
};
