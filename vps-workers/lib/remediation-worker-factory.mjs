import { join, resolve as resolvePath } from 'node:path';
import { createRemediationCaseState } from './remediation-case-state.mjs';
import { redactCodexError } from './remediation-codex-output.mjs';
import { resolveRemediationContainerIdentity } from './remediation-container-identity.mjs';
import { createRemediationDraftPrStatusResolver } from './remediation-draft-pr-status.mjs';
import { runRemediationAutofix } from './remediation-git-workflow.mjs';
import { reconcileRemediationLifecycle } from './remediation-lifecycle-recovery.mjs';
import { retryRemediationNotifications } from './remediation-notification-retry.mjs';
import {
  buildCodexRemediationPrompt,
  buildCodexResearchPrompt,
} from './remediation-policy.mjs';
import { createRemediationPrJournal } from './remediation-pr-journal.mjs';
import { writeRemediationPrompt } from './remediation-prompt-file.mjs';
import { createRemediationState } from './remediation-state.mjs';
import { recordRemediationOutcome } from './remediation-worker-candidate-state.mjs';
import {
  readPositiveInt,
  statePathForMode,
} from './remediation-worker-config.mjs';
import { finalizeRemediationWorkerReport } from './remediation-worker-reporting.mjs';

export function createRemediationWorker({
  lockCapabilityValidator,
  usesGlobalCaseStateLock = true,
}) {
  return async function runRemediationWorker({
    autofixRunner = runRemediationAutofix,
    candidateEnricher,
    candidateLoader,
    containerIdentity,
    draftPrStatusResolver,
    env = process.env,
    fetchFn = fetch,
    logger = console,
    now = () => Date.now(),
    remediationLock,
    workerName,
  } = {}) {
    if (typeof candidateLoader !== 'function') {
      throw new Error('candidateLoader is required');
    }
    if (!workerName) throw new Error('workerName is required');
    const mode =
      env.BACI_REMEDIATION_AUTOFIX_ENABLED === '1' ? 'autofix' : 'dry-run';
    const hasGlobalLock = lockCapabilityValidator(remediationLock);
    if (
      (env.NODE_ENV === 'production' || mode === 'autofix') &&
      !hasGlobalLock
    ) {
      throw new Error(
        'global remediation flock must be held for production or autofix'
      );
    }
    const outputDir = env.BACI_REMEDIATION_OUTPUT_DIR || `logs/${workerName}`;
    const remediationStatePath = statePathForMode(
      env.BACI_REMEDIATION_STATE_PATH || join(outputDir, 'handled-state.json'),
      mode
    );
    const remediationCaseStatePath = statePathForMode(
      env.BACI_REMEDIATION_CASE_STATE_PATH ||
        join(outputDir, 'case-state.json'),
      mode
    );
    const remediationPrJournalPath = statePathForMode(
      env.BACI_REMEDIATION_PR_JOURNAL_PATH ||
        join(outputDir, 'pr-journal.json'),
      mode
    );
    if (
      resolvePath(remediationStatePath) ===
        resolvePath(remediationCaseStatePath) ||
      resolvePath(remediationStatePath) ===
        resolvePath(remediationPrJournalPath) ||
      resolvePath(remediationCaseStatePath) ===
        resolvePath(remediationPrJournalPath)
    ) {
      throw new Error(
        'remediation state, lifecycle, and journal paths must differ'
      );
    }
    const state = createRemediationState({
      now,
      path: remediationStatePath,
      retryDelayMs: readPositiveInt(
        env.BACI_REMEDIATION_RETRY_DELAY_MS,
        6 * 60 * 60 * 1_000
      ),
    });
    const caseState = createRemediationCaseState({
      lockCapabilityValidator,
      now,
      path: remediationCaseStatePath,
      remediationLock: usesGlobalCaseStateLock ? remediationLock : undefined,
    });
    const prJournal = createRemediationPrJournal({
      now,
      path: remediationPrJournalPath,
    });
    const retriedNotifications = await retryRemediationNotifications({
      env,
      fetchFn,
      logger,
      state,
      workerName,
    });
    const actions = retriedNotifications.actions;
    const email = retriedNotifications.email;
    const loadedCandidates = await candidateLoader({ env, fetchFn });
    const maximumCandidates = Math.min(
      readPositiveInt(env.BACI_REMEDIATION_MAX_CANDIDATES_PER_RUN, 1),
      10
    );
    const maximumDraftPrReconciliations = Math.min(
      readPositiveInt(
        env.BACI_REMEDIATION_MAX_DRAFT_PR_RECONCILIATIONS_PER_RUN,
        10
      ),
      10
    );
    if (mode === 'autofix') {
      const reconciliation = caseState.reconcileDraftPrs({
        candidates: loadedCandidates,
        limit: maximumDraftPrReconciliations,
        resolveDraftPrStatus:
          draftPrStatusResolver ||
          createRemediationDraftPrStatusResolver({
            ghBin: env.GH_BIN || 'gh',
          }),
      });
      if (reconciliation.failed > 0) {
        actions.push({ type: 'draft_pr_reconciliation_failed' });
      }
    }
    const reconciledCandidates = reconcileRemediationLifecycle({
      candidates: loadedCandidates,
      caseState,
      journal: prJournal,
      state,
    });
    const lifecycleCandidates = reconciledCandidates.filter(
      (candidate) => !candidate.autofixEligible
    );
    const autofixCandidates = reconciledCandidates.filter(
      (candidate) => candidate.autofixEligible
    );
    state.pending(reconciledCandidates, { limit: 0 });
    let candidates = state.pending(
      caseState.orderCandidates(autofixCandidates),
      {
        limit: maximumCandidates,
      }
    );
    if (candidates.length > 0) {
      const selections = caseState.recordSelections(candidates);
      if (!selections) throw new Error('remediation case state is busy');
      candidates = selections;
    }
    for (const candidate of lifecycleCandidates) {
      actions.push({ type: candidate.lifecycleEvent || 'lifecycle_observed' });
    }
    const autofixContainerIdentity =
      mode === 'autofix'
        ? resolveRemediationContainerIdentity({ containerIdentity })
        : undefined;
    for (const pendingCandidate of candidates) {
      let candidate = pendingCandidate;
      if (typeof candidateEnricher === 'function') {
        try {
          const enrichedCandidate = await candidateEnricher({
            candidate: pendingCandidate,
            env,
            fetchFn,
          });
          candidate =
            enrichedCandidate && typeof enrichedCandidate === 'object'
              ? enrichedCandidate
              : pendingCandidate;
        } catch (error) {
          const safeError = redactCodexError(error);
          const detail = safeError.message;
          actions.push({
            detail,
            fingerprint: pendingCandidate.fingerprint,
            type: 'candidate_enrichment_failed',
          });
          candidates = recordRemediationOutcome({
            candidate: pendingCandidate,
            candidates,
            caseState,
            outcome: {
              detail,
              type: 'candidate_enrichment_failed',
            },
            pendingCandidate,
          });
          if (!state.complete({ deferCandidates: [pendingCandidate] })) {
            throw new Error('remediation state is busy');
          }
          logger.error(
            `[${workerName}] candidate enrichment failed:`,
            safeError
          );
          continue;
        }
      }
      const prompt =
        mode === 'autofix'
          ? buildCodexRemediationPrompt({ candidate })
          : buildCodexResearchPrompt({ candidate });
      const path = writeRemediationPrompt({ candidate, outputDir, prompt });
      actions.push({ path, type: 'prompt_written' });
      logger.log(`[${workerName}] wrote ${path}`);
      if (mode !== 'autofix') {
        candidates = recordRemediationOutcome({
          candidate,
          candidates,
          caseState,
          outcome: { type: 'prompt_written' },
          pendingCandidate,
        });
        if (!state.complete({ handledCandidates: [candidate] })) {
          throw new Error('remediation state is busy');
        }
        continue;
      }
      let result;
      try {
        result = await autofixRunner({
          candidate,
          containerIdentity: autofixContainerIdentity,
          env,
          prompt,
        });
      } catch (error) {
        actions.push({
          detail: error instanceof Error ? error.message : String(error),
          fingerprint: candidate.fingerprint,
          type: 'autofix_failed',
        });
        candidates = recordRemediationOutcome({
          candidate,
          candidates,
          caseState,
          outcome: {
            detail: error instanceof Error ? error.message : String(error),
            type: 'autofix_failed',
          },
          pendingCandidate,
        });
        if (!state.complete({ deferCandidates: [candidate] })) {
          throw new Error('remediation state is busy');
        }
        logger.error(`[${workerName}] autofix failed:`, error);
        continue;
      }
      actions.push(result);
      if (result.type === 'pr_opened') {
        prJournal.record({ candidate, result });
        state.recordHandledFallback([candidate]);
      }
      candidates = recordRemediationOutcome({
        candidate,
        candidates,
        caseState,
        outcome: result,
        pendingCandidate,
      });
      const handled = ['no_changes', 'policy_blocked', 'pr_opened'].includes(
        result.type
      );
      const completed = state.complete(
        handled
          ? { handledCandidates: [candidate] }
          : { deferCandidates: [candidate] }
      );
      if (!completed) {
        throw new Error('remediation state is busy');
      }
      if (result.type === 'pr_opened') prJournal.clear(candidate.caseKey);
    }
    return finalizeRemediationWorkerReport({
      actions,
      candidates: [...candidates, ...lifecycleCandidates],
      email,
      env,
      fetchFn,
      logger,
      mode,
      state,
      workerName,
    });
  };
}
