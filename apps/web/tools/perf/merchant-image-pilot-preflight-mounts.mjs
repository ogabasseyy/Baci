// Served mount coverage: every intended accepted binding must have an
// actual mount of the expected kind/identity — not just a reporting row.
// Reporting rows (not-optimized / missing-binding) are collected for the
// audit trail and excluded from optimized coverage; an expected mount that
// renders only a reporting row fails.

import { extractLabSections } from './merchant-image-pilot-preflight-html.mjs';

import {
  checkCardMount,
  checkHeroMount,
  checkLogoMount,
} from './merchant-image-pilot-preflight-mount-kinds.mjs';

function checkMountKind(section, mount, { arm, origin, surface }) {
  if (mount.role === 'hero') {
    return checkHeroMount(section, mount, { arm, origin });
  }
  if (mount.role === 'logo') {
    return checkLogoMount(section, mount, { arm, origin, surface });
  }
  return checkCardMount(section, mount, { arm, origin, surface });
}

export function assertServedMountCoverage(
  html,
  { arm, expectedMounts, expectedUncovered = [], origin, surface }
) {
  const failures = [];
  const mounted = [];
  const reported = [];
  const uncovered = [];
  const sections = extractLabSections(html);
  const byBinding = new Map(
    sections
      .filter((section) => section.binding)
      .map((section) => [section.binding, section])
  );
  // A Map keeps only the last section per binding: without a duplicate
  // count, one valid mount could satisfy coverage while a twin section
  // alters layout or issues extra image requests unvalidated.
  const bindingCounts = new Map();
  for (const section of sections) {
    if (!section.binding) {
      continue;
    }
    bindingCounts.set(
      section.binding,
      (bindingCounts.get(section.binding) ?? 0) + 1
    );
  }
  for (const section of sections) {
    if (section.status) {
      reported.push({
        binding: section.binding,
        slotId: section.slotId,
        status: section.status,
      });
    }
  }
  for (const mount of expectedMounts ?? []) {
    const name = `mount-coverage:${mount.binding}`;
    const section = byBinding.get(mount.binding);
    if (!section) {
      failures.push(
        `${name}: expected ${mount.slotId} mount is absent from the served ${surface} ${arm} page`
      );
      continue;
    }
    if (section.status) {
      failures.push(
        `${name}: expected ${mount.slotId} mount renders only "${section.status}"`
      );
      continue;
    }
    const rendered = bindingCounts.get(mount.binding) ?? 0;
    if (rendered > 1) {
      failures.push(
        `${name}: expected ${mount.slotId} mount renders ${rendered} sections for one binding (duplicate mount)`
      );
      continue;
    }
    const problems = checkMountKind(section, mount, { arm, origin, surface });
    if (problems.length > 0) {
      for (const problem of problems) {
        failures.push(`${name}: ${problem}`);
      }
      continue;
    }
    mounted.push(mount.binding);
  }
  // Declared uncovered consumers: the registry names committed-plan slots
  // the sample does not exercise, and the store page renders an explicit
  // uncovered-consumer marker for each. A silently dropped marker would
  // exclude the consumer from every denominator without a trace, so each
  // expected marker must render (status + slot identity; markers carry
  // no binding by design).
  for (const entry of expectedUncovered ?? []) {
    const name = `mount-coverage:${entry.slotId}`;
    const marker = sections.find(
      (section) =>
        section.status === 'uncovered-consumer' &&
        section.slotId === entry.slotId
    );
    if (!marker) {
      failures.push(
        `${name}: expected uncovered-consumer marker for slot "${entry.slotId}" is absent from the served ${surface} ${arm} page`
      );
      continue;
    }
    uncovered.push(entry.slotId);
  }
  return { failures, mounted, reported, uncovered };
}
