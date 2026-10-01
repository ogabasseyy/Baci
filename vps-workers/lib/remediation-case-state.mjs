import { createRemediationCaseCandidateNormalizer } from './remediation-case-candidate.mjs';
import { capRemediationCases } from './remediation-case-cap.mjs';
import {
  candidateWithLifecycle,
  contextForCandidate,
} from './remediation-case-context.mjs';
import { createStoredDraftPrReconciler } from './remediation-case-draft-pr-reconciliation.mjs';
import { quietStaleRemediationCases } from './remediation-case-state-quiet.mjs';
import { createRemediationCaseStateStorage } from './remediation-case-state-storage.mjs';
import { createRemediationCaseStateValidator } from './remediation-case-state-validation.mjs';

const CASE_STATE_VERSION = 1;
const MAX_CASES = 1_000;
const MAX_OUTCOMES = 5;
const MAX_SAMPLES = 3;
const CASE_STATUSES = new Set([
  'legacy_handled',
  'open',
  'investigating',
  'pr_open',
  'quiet',
]);
const isValidState = createRemediationCaseStateValidator({
  caseStatuses: CASE_STATUSES,
  maxCases: MAX_CASES,
  maxOutcomes: MAX_OUTCOMES,
  maxSamples: MAX_SAMPLES,
  version: CASE_STATE_VERSION,
});

const emptyState = () => ({
  cases: {},
  fairness: { lastCategory: '' },
  version: CASE_STATE_VERSION,
});

function observationAdvanced(item, candidate) {
  if (!item) return true;
  if (candidate.lastSeen && item.lastSeen) {
    const candidateSeen = Date.parse(candidate.lastSeen);
    const itemSeen = Date.parse(item.lastSeen);
    return (
      candidateSeen > itemSeen ||
      (candidateSeen === itemSeen &&
        candidate.occurrences > Number(item.observedOccurrences || 0))
    );
  }
  if (candidate.lastSeen && !item.lastSeen) return true;
  return candidate.observationMarker !== item.observationMarker;
}

function capCases(state) {
  state.cases = capRemediationCases(state.cases, MAX_CASES);
}

export function createRemediationCaseState({
  lockCapabilityValidator,
  now = () => Date.now(),
  path,
  remediationLock,
}) {
  const candidateNormalizer = createRemediationCaseCandidateNormalizer();
  const storage = createRemediationCaseStateStorage({
    createEmptyState: emptyState,
    isValidState,
    lockCapabilityValidator,
    path,
    remediationLock,
  });
  const reconcileDraftPrs = createStoredDraftPrReconciler({
    maxOutcomes: MAX_OUTCOMES,
    normalizeCandidate: candidateNormalizer.normalize,
    now,
    storage,
  });
  return {
    reconcile(candidates) {
      const nowMs = now();
      return storage.withLock(nowMs, [], (state) => {
        quietStaleRemediationCases(state, nowMs);
        const normalized = candidateNormalizer.normalizeAll(candidates);
        const observedCandidates = [];
        for (const candidate of normalized) {
          const existing = state.cases[candidate.caseKey];
          if (!observationAdvanced(existing, candidate)) continue;
          const increment = existing
            ? Math.max(
                1,
                candidate.occurrences -
                  Number(existing.observedOccurrences || 0)
              )
            : candidate.occurrences;
          const item = existing || {
            category: candidate.category,
            draftPr: null,
            firstSeen: candidate.firstSeen,
            fingerprint: candidate.fingerprint,
            key: candidate.caseKey,
            outcomes: [],
            recurrenceCount: 0,
            samples: [],
            source: candidate.source,
            status: 'open',
            totalObservations: 0,
          };
          if (existing) {
            item.recurrenceCount += 1;
            if (item.draftPr) {
              item.status = 'pr_open';
            } else if (item.status !== 'pr_open') {
              item.status = 'open';
            }
          }
          item.firstSeen =
            !item.firstSeen ||
            (candidate.firstSeen && candidate.firstSeen < item.firstSeen)
              ? candidate.firstSeen
              : item.firstSeen;
          item.lastSeen = candidate.lastSeen || item.lastSeen || '';
          item.observationMarker = candidate.observationMarker;
          item.observedOccurrences = candidate.occurrences;
          item.samples = [...item.samples, candidate.sample].slice(
            -MAX_SAMPLES
          );
          item.totalObservations += increment;
          state.cases[candidate.caseKey] = item;
          observedCandidates.push(candidate);
        }
        quietStaleRemediationCases(state, nowMs);
        capCases(state);
        storage.persist(state);
        const selectableCandidates = normalized.filter((candidate) => {
          const item = state.cases[candidate.caseKey];
          if (!item) return false;
          return (
            !['legacy_handled', 'quiet', 'pr_open'].includes(item.status) &&
            !item.draftPr
          );
        });
        const activeDraftRecurrences = observedCandidates.filter((candidate) =>
          Boolean(state.cases[candidate.caseKey]?.draftPr)
        );
        const legacyHandledRecurrences = observedCandidates.filter(
          (candidate) =>
            state.cases[candidate.caseKey]?.status === 'legacy_handled'
        );
        return [
          ...selectableCandidates.map((candidate) =>
            candidateWithLifecycle(state, candidate, { autofixEligible: true })
          ),
          ...activeDraftRecurrences.map((candidate) =>
            candidateWithLifecycle(state, candidate, {
              autofixEligible: false,
              lifecycleEvent: 'active_draft_recurrence',
            })
          ),
          ...legacyHandledRecurrences.map((candidate) =>
            candidateWithLifecycle(state, candidate, {
              autofixEligible: false,
              lifecycleEvent: 'legacy_handled_recurrence',
            })
          ),
        ];
      });
    },
    reconcileDraftPrs,
    migrateLegacyHandled(candidates) {
      const nowMs = now();
      return storage.withLock(nowMs, false, (state) => {
        for (const rawCandidate of candidates) {
          const candidate = candidateNormalizer.normalize(rawCandidate);
          if (!candidate || state.cases[candidate.caseKey]) continue;
          state.cases[candidate.caseKey] = {
            category: candidate.category,
            draftPr: null,
            firstSeen: candidate.firstSeen,
            fingerprint: candidate.fingerprint,
            key: candidate.caseKey,
            lastSeen: candidate.lastSeen,
            observationMarker: candidate.observationMarker,
            observedOccurrences: candidate.occurrences,
            outcomes: [
              {
                at: new Date(nowMs).toISOString(),
                detail: 'legacy handled fingerprint has unknown outcome',
                type: 'legacy_handled',
              },
            ],
            recurrenceCount: 0,
            samples: [candidate.sample],
            source: candidate.source,
            status: 'legacy_handled',
            totalObservations: candidate.occurrences,
          };
        }
        capCases(state);
        storage.persist(state);
        return true;
      });
    },
    orderCandidates(candidates) {
      const state = storage.read();
      const groups = new Map();
      for (const candidate of candidates) {
        const group = groups.get(candidate.category) || [];
        group.push(candidate);
        groups.set(candidate.category, group);
      }
      const categories = [...groups.keys()].sort();
      const cursor = categories.indexOf(state.fairness.lastCategory);
      const orderedCategories =
        cursor < 0
          ? categories
          : [
              ...categories.slice(cursor + 1),
              ...categories.slice(0, cursor + 1),
            ];
      const ordered = [];
      while (
        orderedCategories.some((category) => groups.get(category).length > 0)
      ) {
        for (const category of orderedCategories) {
          const next = groups.get(category).shift();
          if (next) ordered.push(next);
        }
      }
      return ordered;
    },
    recordSelections(candidates) {
      const nowMs = now();
      return storage.withLock(nowMs, false, (state) => {
        const selected = candidates.map((candidate) => {
          const item = state.cases[candidate.caseKey];
          if (item) {
            item.status = 'investigating';
            return candidateWithLifecycle(state, candidate);
          }
          return candidate;
        });
        const last = candidates.at(-1);
        if (last) state.fairness.lastCategory = last.category;
        storage.persist(state);
        return selected;
      });
    },
    recordOutcome(candidate, outcome) {
      const nowMs = now();
      const normalized = candidateNormalizer.normalize(candidate);
      if (!normalized) return false;
      return storage.withLock(nowMs, false, (state) => {
        const item = state.cases[normalized.caseKey];
        if (!item) return false;
        const result = {
          at: new Date(nowMs).toISOString(),
          detail: candidateNormalizer.sanitize(outcome?.detail, 500),
          type: candidateNormalizer.sanitize(outcome?.type, 80) || 'unknown',
        };
        const prUrl = candidateNormalizer.sanitize(
          outcome?.prUrl || outcome?.pullRequestUrl,
          500
        );
        if (prUrl) result.prUrl = prUrl;
        item.outcomes = [...item.outcomes, result].slice(-MAX_OUTCOMES);
        if (result.type === 'pr_opened' && prUrl) {
          item.draftPr = {
            branch: candidateNormalizer.sanitize(outcome?.branch, 160),
            openedAt: result.at,
            url: prUrl,
          };
          item.status = 'pr_open';
        } else if (!['legacy_handled', 'pr_open'].includes(item.status)) {
          item.status = 'open';
        }
        storage.persist(state);
        return candidateWithLifecycle(state, normalized);
      });
    },
    contextFor(candidate) {
      const normalized = candidateNormalizer.normalize(candidate);
      return normalized
        ? contextForCandidate(storage.read(), normalized)
        : { cases: [], category: '' };
    },
    snapshot() {
      return storage.read();
    },
  };
}
