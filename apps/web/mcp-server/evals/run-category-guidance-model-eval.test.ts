import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  git: vi.fn(),
  write: vi.fn(),
  evaluate: vi.fn(),
  model: { id: 'configured-test-model' },
}));
vi.mock('node:child_process', () => ({ execFileSync: mocks.git, default: { execFileSync: mocks.git } }));
vi.mock('node:fs', () => ({ writeFileSync: mocks.write, default: { writeFileSync: mocks.write } }));
vi.mock('../../src/ai/provider', () => ({ ACTIVE_TEXT_MODEL_NAME: 'test-model', activeTextModel: mocks.model }));
vi.mock('./category-guidance-model-eval', () => ({ runCategoryGuidanceModelEval: mocks.evaluate }));
import { runCategoryGuidanceModelCli } from './run-category-guidance-model-eval';

const originalArgs = [...process.argv];
const originalExitCode = process.exitCode;

// CLI boundary tests mock the provider; these never invoke a model or write evidence.
describe('model planning CLI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = ['node', 'runner', '/tmp/evidence.json'];
    process.exitCode = undefined;
    for (const key of ['GOOGLE_GENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY']) vi.stubEnv(key, '');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.evaluate.mockResolvedValue({ passed: true, cases: [{ caseId: 'camera' }] });
    mocks.git.mockImplementation((_cmd: string, args: string[]) => args[0] === 'rev-parse' ? 'test-head\n' : ' M eval.ts\n');
  });
  afterEach(() => {
    process.argv = [...originalArgs];
    process.exitCode = originalExitCode;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it.each([undefined, 'relative.json', '/tmp/evidence.txt'])('rejects invalid output argument %s without calling a provider', async (arg) => {
    process.argv = ['node', 'runner', ...(arg === undefined ? [] : [arg])];
    await runCategoryGuidanceModelCli();
    expect(process.exitCode).toBe(1);
    expect(mocks.evaluate).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.git).not.toHaveBeenCalled();
  });
  it('rejects an unconfigured test environment before calling a provider', async () => {
    await runCategoryGuidanceModelCli();
    expect(process.exitCode).toBe(1);
    expect(mocks.evaluate).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No calls made'));
  });
  it('writes actual result and module-relative Git provenance on success', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'mock-configured');
    await runCategoryGuidanceModelCli();
    expect(mocks.evaluate).toHaveBeenCalledWith(mocks.model);
    expect(mocks.write).toHaveBeenCalledOnce();
    const [path, serialized] = mocks.write.mock.calls[0];
    expect(path).toBe('/tmp/evidence.json');
    expect(JSON.parse(serialized)).toMatchObject({ passed: true, provenance: { model: 'test-model', baseHead: 'test-head', worktreeDirty: true, samplesPerCase: 1, capturedAt: expect.any(String) } });
    for (const call of mocks.git.mock.calls) expect(call[2]).toMatchObject({ cwd: expect.stringMatching(/Baci-app$/) });
    expect(process.exitCode).toBeUndefined();
  });
  it('writes failed model evidence and exits nonzero rather than masking a RED case', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'mock-configured');
    mocks.evaluate.mockResolvedValue({ passed: false, cases: [{ grade: { passed: false } }] });
    await runCategoryGuidanceModelCli();
    expect(JSON.parse(mocks.write.mock.calls[0][1]).passed).toBe(false);
    expect(process.exitCode).toBe(1);
  });
  it.each(['provider', 'git', 'write'])('redacts a %s failure and exits nonzero', async (failure) => {
    vi.stubEnv('GEMINI_API_KEY', 'mock-configured');
    const error = new Error('sensitive-response-token');
    if (failure === 'provider') mocks.evaluate.mockRejectedValue(error);
    if (failure === 'git') mocks.git.mockImplementation(() => { throw error; });
    if (failure === 'write') mocks.write.mockImplementation(() => { throw error; });
    await runCategoryGuidanceModelCli();
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith('{"error":"Error"}');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('sensitive-response-token');
    if (failure !== 'write') expect(mocks.write).not.toHaveBeenCalled();
    mocks.write.mockReset();
  });
});
