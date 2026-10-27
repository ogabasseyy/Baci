import type { JumiaBrandItem } from './brand-selector';
import type { JumiaCategorySelection } from './category-selector';
import type { JumiaDraftValues } from './jumia-attribute-values';

export type JumiaMappingDestination = {
  merchantId: string;
  integrationId: string;
  businessClientCode: string;
  countryCode: string;
};

export type JumiaMappingDraft = JumiaMappingDestination & {
  category: JumiaCategorySelection;
  brand: JumiaBrandItem;
  attributeSetId: string;
  attributes: JumiaDraftValues;
  bullets: string[];
  variation?: { sourceAttributeName: string };
  categoryConfirmed: boolean;
};
