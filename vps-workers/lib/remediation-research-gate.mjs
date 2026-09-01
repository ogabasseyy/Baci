import { buildRemediationCodexCommand } from './remediation-codex-command.mjs';
import { redactCodexOutput } from './remediation-codex-output.mjs';
import {
  appendValidatedResearch,
  buildCodexRemediationPrompt,
  buildCodexResearchPrompt,
  MAX_VALIDATED_RESEARCH_CHARS,
} from './remediation-policy.mjs';
import { readPositiveInt } from './remediation-worker-config.mjs';

const REQUIRED_HEADINGS = [
  'RESEARCH_SUMMARY',
  'ROOT_CAUSE_CONFIDENCE',
  'OPTIONS_CONSIDERED',
  'SELECTED_FIX',
  'VALIDATION_PLAN',
];
const MIN_SECTION_LENGTHS = {
  OPTIONS_CONSIDERED: 12,
  RESEARCH_SUMMARY: 20,
  SELECTED_FIX: 12,
  VALIDATION_PLAN: 12,
};

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) =>
      typeof item === 'string'
        ? item
        : typeof item?.text === 'string'
          ? item.text
          : ''
    )
    .filter(Boolean)
    .join('\n');
}

function extractEventText(event) {
  if (
    event?.type !== 'item.completed' ||
    event.item?.type !== 'agent_message'
  ) {
    return '';
  }
  return [
    event?.item?.text,
    textFromContent(event?.item?.content),
    event?.text,
    event?.response?.output_text,
  ]
    .filter((value) => typeof value === 'string')
    .join('\n');
}

export function extractCodexResearchText(stdout) {
  return String(stdout || '')
    .split('\n')
    .flatMap((line) => {
      if (!line.trim()) return [];
      try {
        return [extractEventText(JSON.parse(line))];
      } catch {
        return [];
      }
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function sectionFor(text, heading) {
  const lines = text.split(/\r?\n/);
  const headingPattern = new RegExp(
    `^\\s*(?:#{1,6}\\s*)?${heading}\\b\\s*:?\\s*(.*)$`,
    'i'
  );
  const nextHeading = new RegExp(
    `^\\s*(?:#{1,6}\\s*)?(?:${REQUIRED_HEADINGS.join('|')})\\b`,
    'i'
  );
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start < 0) return '';
  const first = lines[start].match(headingPattern)?.[1] || '';
  const rest = [];
  for (const line of lines.slice(start + 1)) {
    if (nextHeading.test(line)) break;
    rest.push(line);
  }
  return [first, ...rest].join('\n').trim();
}

function exactConfidenceValue(value) {
  const normalized = String(value || '').trim();
  const formatted = normalized.match(
    /^(?:\*\*|__|`)(high|medium|low)(?:\*\*|__|`)$/i
  );
  return (formatted ? formatted[1] : normalized).toLowerCase();
}

export function validateCodexResearchResult(stdout) {
  const extracted = extractCodexResearchText(stdout);
  const text = redactCodexOutput(extracted)
    .slice(0, MAX_VALIDATED_RESEARCH_CHARS)
    .replaceAll('<', '\\u003c')
    .trim();
  const sections = Object.fromEntries(
    REQUIRED_HEADINGS.map((heading) => [heading, sectionFor(text, heading)])
  );
  const reasons = REQUIRED_HEADINGS.filter((heading) => !sections[heading]).map(
    (heading) => `research heading missing or empty: ${heading}`
  );
  for (const [heading, minimum] of Object.entries(MIN_SECTION_LENGTHS)) {
    if (sections[heading] && sections[heading].length < minimum) {
      reasons.push(
        `research heading is too short to be defensible: ${heading}`
      );
    }
  }
  if (
    sections.ROOT_CAUSE_CONFIDENCE &&
    !['high', 'medium', 'low'].includes(
      exactConfidenceValue(sections.ROOT_CAUSE_CONFIDENCE)
    )
  ) {
    reasons.push('root-cause confidence must be high, medium, or low');
  }
  const optionLines = (sections.OPTIONS_CONSIDERED || '')
    .split(/\r?\n/)
    .filter((line) =>
      [
        /^\s*(?:[-*]|\d+[.)])\s+\S+/,
        /^\s*(?:#{1,6}\s*)?Option\s+[A-Z0-9]+\s*(?::|[.)-])\s*\S+/i,
        /^\s*(?:#{1,6}\s*)?Option\s+[A-Z0-9]+\s*$/i,
      ].some((pattern) => pattern.test(line))
    );
  if (sections.OPTIONS_CONSIDERED && optionLines.length < 2) {
    reasons.push('research must compare at least two plausible options');
  }
  if (
    sections.SELECTED_FIX &&
    /\b(?:no\s+(?:a\s+)?defensible(?:\s+\w+){0,4}\s+fix|none|unable to|cannot safely)\b/i.test(
      sections.SELECTED_FIX
    )
  ) {
    reasons.push('research did not establish a defensible selected fix');
  }
  return {
    accepted: reasons.length === 0,
    reasons,
    sections,
    text,
  };
}

export function runRemediationCodexPhase({
  codexBin,
  commandEnv,
  prompt,
  readOnly,
  repoDir,
  runner,
  runCodex,
  timeout,
  worktreeCommandOptions,
  worktreeDir,
}) {
  const command = buildRemediationCodexCommand({
    codexBin,
    env: commandEnv,
    prompt,
    readOnly,
    repoDir,
    worktreeDir,
    enableSearch: true,
  });
  try {
    return runCodex(command.command, command.args, {
      ...worktreeCommandOptions,
      timeout,
    });
  } finally {
    if (command.cleanup) {
      runner(command.cleanup.command, command.cleanup.args, {
        cwd: worktreeDir,
        env: worktreeCommandOptions.env,
        shell: false,
      });
    }
  }
}

export function runRemediationCodexPhases({
  candidate,
  commandEnv,
  codexBin,
  prompt,
  repoDir,
  runner,
  runCodex,
  worktreeCommandOptions,
  worktreeDir,
}) {
  const timeout = readPositiveInt(
    commandEnv.BACI_CODEX_TIMEOUT_MS,
    6 * 60 * 1000
  );
  const researchExecution = runRemediationCodexPhase({
    codexBin,
    commandEnv,
    prompt: buildCodexResearchPrompt({ candidate }),
    readOnly: true,
    repoDir,
    runner,
    runCodex,
    timeout,
    worktreeCommandOptions,
    worktreeDir,
  });
  const research = validateCodexResearchResult(researchExecution.stdout);
  if (!research.accepted) return { research, researchExecution };
  const implementationPrompt = appendValidatedResearch(
    prompt || buildCodexRemediationPrompt({ candidate }),
    research.text
  );
  return {
    implementationExecution: runRemediationCodexPhase({
      codexBin,
      commandEnv,
      prompt: implementationPrompt,
      readOnly: false,
      repoDir,
      runner,
      runCodex,
      timeout,
      worktreeCommandOptions,
      worktreeDir,
    }),
    research,
    researchExecution,
  };
}
