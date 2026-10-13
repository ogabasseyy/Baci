import { isComputerExcludedSpecKey } from './is-computer-excluded-spec-key';
import { KEY_SPEC_CATEGORIES } from './spec-taxonomy';

const COMPUTER_KEY_SPEC_CATEGORIES = KEY_SPEC_CATEGORIES.map((category) => ({
  ...category,
  fields: category.fields.filter(({ key }) => !isComputerExcludedSpecKey(key)),
})).filter((category) => category.fields.length > 0);

export function getComputerKeySpecCategoryProjection() {
  return COMPUTER_KEY_SPEC_CATEGORIES;
}
