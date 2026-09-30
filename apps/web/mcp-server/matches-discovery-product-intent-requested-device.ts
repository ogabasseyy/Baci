import {
  deviceQualifierAliases,
  phoneAccessoryTypes,
} from './matches-discovery-product-intent-vocab';
import { matchesWord } from './matches-discovery-product-intent-word-match';
import { type IntentWordScope } from './matches-discovery-product-intent-word-scope';

/** A device noun that qualifies the item ("phone" in "phone case") must agree
 * with the product's identity; a conflicting device head rejects the candidate. */
export function matchesRequestedDevice(
  requestedDevice: string | undefined, scope: IntentWordScope
): boolean {
  if (!requestedDevice) return true;
  const aliases = deviceQualifierAliases.get(requestedDevice) ?? [];
  const identifiesRequested = aliases.some((alias) => matchesWord(scope.deviceIdentityText, alias));
  const identifiesConflicting = [...deviceQualifierAliases.values()].some((otherAliases) =>
    !aliases.some((alias) => otherAliases.includes(alias)) &&
    otherAliases.some((alias) => matchesWord(scope.deviceIdentityText, alias))
  );
  const accessoryTypeIndex = scope.nameWords.findLastIndex((word) => phoneAccessoryTypes.has(word));
  const titleQualifier = scope.nameWords.slice(0, accessoryTypeIndex < 0 ? scope.nameWords.length : accessoryTypeIndex)
    .findLast((word) => deviceQualifierAliases.has(word));
  if (titleQualifier) {
    const titleQualifierAliases = deviceQualifierAliases.get(titleQualifier) ?? [];
    if (!aliases.some((alias) => titleQualifierAliases.includes(alias))) return false;
  }
  return !identifiesConflicting || identifiesRequested;
}
