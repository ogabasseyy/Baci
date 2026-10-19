const candidate = {
  fingerprint: 'abc123',
  occurrences: 3,
  sample: {
    message: 'TypeError: Cannot read properties of undefined',
    route: '/api/products',
  },
};

const defaultResearchResult = {
  status: 0,
  stdout:
    '{"type":"item.completed","item":{"type":"agent_message","text":"RESEARCH_SUMMARY: traced the failure to the reported boundary.\\nROOT_CAUSE_CONFIDENCE: medium\\nOPTIONS_CONSIDERED:\\n- smallest code fix\\n- operational mitigation\\nSELECTED_FIX: smallest code fix\\nVALIDATION_PLAN: run the focused regression suite"}}\n{"type":"turn.completed"}\n',
  stderr: '',
};
const defaultImplementationResult = {
  status: 0,
  stdout: '{"type":"turn.completed"}\n',
  stderr: '',
};

const isResearchInvocation = (command, args) =>
  (command === 'codex' &&
    args.includes('--sandbox') &&
    args.includes('read-only')) ||
  (command === 'docker' && args.includes('--read-only'));

function makeRunner({
  changedFiles,
  cleanupResult,
  remediationResult,
  researchResult,
  implementationResult,
  statusOutput,
  verificationResult,
} = {}) {
  const calls = [];
  const environments = [];
  const registeredWorktrees = new Map();
  return {
    calls,
    environments,
    runner(command, args, options) {
      calls.push([command, ...args]);
      environments.push({
        args,
        command,
        env: options?.env || {},
        timeout: options?.timeout,
      });
      const joined = [command, ...args].join(' ');
      if (command === 'git' && joined === 'git worktree list --porcelain') {
        return {
          status: 0,
          stdout: [...registeredWorktrees]
            .map(
              ([directory, branch]) =>
                `worktree ${directory}\nHEAD deadbeef\nbranch refs/heads/${branch}\n`
            )
            .join('\n'),
          stderr: '',
        };
      }
      if (command === 'git' && args[0] === 'worktree' && args[1] === 'add') {
        registeredWorktrees.set(args[2], args[args.indexOf('-b') + 1]);
        return { status: 0, stdout: '', stderr: '' };
      }
      if (command === 'git' && args[0] === 'worktree' && args[1] === 'remove') {
        registeredWorktrees.delete(args.at(-1));
        return { status: 0, stdout: '', stderr: '' };
      }
      if (joined.includes('rev-list --count origin/main..HEAD')) {
        return { status: 0, stdout: '0\n', stderr: '' };
      }
      if (joined.includes('status --porcelain')) {
        return {
          status: 0,
          stdout:
            statusOutput ??
            (changedFiles ?? 'apps/web/src/components/cart.tsx\n')
              .split('\n')
              .filter(Boolean)
              .map((path) => ` M ${path}`)
              .join('\n'),
          stderr: '',
        };
      }
      if (joined.includes('pr list')) {
        return { status: 0, stdout: '[]\n', stderr: '' };
      }
      if (joined.includes('pr create')) {
        return {
          status: 0,
          stdout: 'https://github.com/ogabasseyy/Baci/pull/999\n',
          stderr: '',
        };
      }
      if (command === 'codex') {
        if (remediationResult) return remediationResult;
        return args.includes('--sandbox') && args.includes('read-only')
          ? (researchResult ?? defaultResearchResult)
          : (implementationResult ?? defaultImplementationResult);
      }
      if (command === 'bash') {
        return verificationResult ?? { status: 0, stdout: '', stderr: '' };
      }
      if (command === 'docker') {
        if (args[0] === 'rm') {
          return cleanupResult ?? { status: 0, stdout: '', stderr: '' };
        }
        if (args.includes('--read-only'))
          return researchResult ?? defaultResearchResult;
        if (args.includes('--dangerously-bypass-approvals-and-sandbox'))
          return implementationResult ?? defaultImplementationResult;
        return verificationResult ?? { status: 0, stdout: '', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
  };
}

export const remediationGitWorkflowTestFixtures = {
  candidate,
  defaultResearchResult,
  isResearchInvocation,
  makeRunner,
};
