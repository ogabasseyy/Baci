import { afterEach,beforeEach,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({process:vi.fn(),appUrl:vi.fn()}));
vi.mock('@/env',()=>({getConfiguredAppUrl:mocks.appUrl}));
vi.mock('@/lib/supabase/service',()=>({createServiceClient:()=> ({})}));
vi.mock('@/lib/zeptomail',()=>({sendEmail:vi.fn()}));
vi.mock('@/lib/onboarding-emails/repository',()=>({createJourneyRepository:()=> ({})}));
vi.mock('@/lib/onboarding-emails/worker',()=>({processOnboardingEmailBatch:mocks.process}));
import { runMerchantOnboardingEmailsCli } from './process-merchant-onboarding-emails';
beforeEach(()=>{vi.clearAllMocks();mocks.appUrl.mockReturnValue('https://usebaci.com');});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it('returns success for a disabled empty queue without printing recipients',async()=>{const log=vi.spyOn(console,'log').mockImplementation(()=>undefined);mocks.process.mockResolvedValue({processed:0,accepted:0,unknown:0,failed:0});expect(await runMerchantOnboardingEmailsCli()).toBe(0);expect(JSON.parse(log.mock.calls[0][0])).toEqual({worker:'merchant-onboarding-emails',processed:0,accepted:0,unknown:0,failed:0});});
it.each([{unknown:1,failed:0},{unknown:0,failed:1}])('alerts for unresolved or failed work %j',async counts=>{vi.spyOn(console,'log').mockImplementation(()=>undefined);mocks.process.mockResolvedValue({processed:1,accepted:0,...counts});expect(await runMerchantOnboardingEmailsCli()).toBe(1);});
it('does not expose provider secrets when the worker fails',async()=>{const error=vi.spyOn(console,'error').mockImplementation(()=>undefined);mocks.process.mockRejectedValue(Error('private-provider-secret'));expect(await runMerchantOnboardingEmailsCli()).toBe(1);expect(JSON.stringify(error.mock.calls)).not.toContain('private-provider-secret');});

it('uses the provisioned VPS origin when no app URL is configured',async()=>{vi.spyOn(console,'log').mockImplementation(()=>undefined);mocks.appUrl.mockReturnValue(null);vi.stubEnv('BACI_WEB_BASE_URL','https://usebaci.test/path');mocks.process.mockResolvedValue({processed:0,accepted:0,unknown:0,failed:0});expect(await runMerchantOnboardingEmailsCli()).toBe(0);expect(mocks.process.mock.calls[0][2]).toBe('https://usebaci.test');});
it.each(['','http://usebaci.test','https://user:password@usebaci.test','not-a-url'])('fails before claiming work for an invalid origin %s',async url=>{vi.spyOn(console,'error').mockImplementation(()=>undefined);mocks.appUrl.mockReturnValue(null);vi.stubEnv('BACI_WEB_BASE_URL',url);expect(await runMerchantOnboardingEmailsCli()).toBe(1);expect(mocks.process).not.toHaveBeenCalled();});
