import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { deriveCampaignMark, parseRunnerPolicy } from './policy.schema.mjs';

const policyUrl = new URL('./policy.json', import.meta.url);
const wirePolicy = JSON.parse(await readFile(policyUrl, 'utf8'));
const policy = parseRunnerPolicy(wirePolicy);
const clone = (value = wirePolicy) => structuredClone(value);
const fromJson = (value) => JSON.parse(value);

function mutate(pointer, value, operation = 'set') {
  const candidate = clone();
  const parts = pointer.split('/').slice(1);
  const key = parts.pop();
  let parent = candidate;
  for (const part of parts) parent = parent[part];
  if (operation === 'delete') delete parent[key];
  else parent[key] = value;
  return candidate;
}

test('accepts the frozen policy and proves its repository authority', async () => {
  assert.equal(parseRunnerPolicy(wirePolicy), policy);
  assert.deepEqual(policy.authority, {
    normativeContractPath:
      'docs/superpowers/plans/2026-07-13-ogabassey-home-critical-shell-v4.md',
    normativeContractSha256:
      '3503ca9613b6a511b2e37fb3d35b48830d19e8559e7e3c5df136487fce9efdca',
    implementationBaseSha: 'f706fc9f309516aa776515e094120039e2431d34',
    deploymentRunId: 29733124902,
    deploymentRunAttempt: 2,
    deploymentMarker: '29733124902_2_f706fc9f309516aa7765',
  });
  const contract = await readFile(policy.authority.normativeContractPath);
  assert.equal(
    createHash('sha256').update(contract).digest('hex'),
    policy.authority.normativeContractSha256
  );
  execFileSync('git', [
    'cat-file',
    '-e',
    `${policy.authority.implementationBaseSha}^{commit}`,
  ]);
  assert.equal(
    policy.authority.deploymentMarker,
    `${policy.authority.deploymentRunId}_${policy.authority.deploymentRunAttempt}_${policy.authority.implementationBaseSha.slice(0, 20)}`
  );
});

test('freezes runner, resources, installation import, and runtime isolation', () => {
  assert.equal(
    policy.runner.labels.join(','),
    'self-hosted,Linux,X64,baci-cwv-measurement'
  );
  assert.deepEqual(
    policy.resources,
    fromJson(
      '{"measurementCpuSet":"2-3","otherCpuSet":"0-1","memoryBytes":8589934592,"memorySwapBytes":0,"shmBytes":1073741824,"pidsLimit":1024}'
    )
  );
  assert.deepEqual(
    policy.installationImport,
    fromJson(
      '{"workerServices":["baci-cwv-docker.service","baci-cwv-containerd.service"],"cpuSet":"2-3","cpuQuotaPercent":100,"memoryBytes":2147483648,"memorySwapBytes":0,"pidsLimit":256,"ioWeight":10,"sampleSeconds":2}'
    )
  );
  assert.deepEqual(
    policy.dedicatedRuntime,
    fromJson(
      '{"dockerService":"baci-cwv-docker.service","containerdService":"baci-cwv-containerd.service","dockerSocket":"/run/baci-cwv/docker.sock","containerdSocket":"/run/baci-cwv/containerd/containerd.sock","dockerDataRoot":"/srv/baci-cwv/docker","dockerExecRoot":"/run/baci-cwv/docker-exec","dockerPidFile":"/run/baci-cwv/docker.pid","containerdRoot":"/srv/baci-cwv/containerd/root","containerdState":"/run/baci-cwv/containerd","networkName":"baci-cwv-net","bridgeName":"baci-cwv0","subnet":"172.31.255.0/28","gateway":"172.31.255.1","daemonIptables":false,"daemonIpForward":false,"daemonIpMasq":false,"enableIpv6":false,"firewallBackend":"iptables-nft","firewallInputChain":"INPUT","firewallForwardChain":"DOCKER-USER","firewallNatChain":"POSTROUTING","ownedInputChainPrefix":"BACI_CWV_IN_","ownedForwardChainPrefix":"BACI_CWV_FW_","ruleCommentPrefix":"baci-cwv:","deniedDestinationCidrs":["0.0.0.0/8","10.0.0.0/8","100.64.0.0/10","127.0.0.0/8","169.254.0.0/16","172.16.0.0/12","192.0.0.0/24","192.168.0.0/16","198.18.0.0/15","224.0.0.0/4","240.0.0.0/4"],"requiredHostIpv4Forward":1,"registrationProbeHost":"github.com","registrationProbePort":443,"registrationProbeTimeoutSeconds":10}'
    )
  );
  assert.deepEqual(
    policy.processAllowSet,
    fromJson(
      '{"schemaVersion":1,"receiptBinding":"image-process-map-v1","phases":["held","listener-idle","assigned","cleanup"],"executables":{"bash":{"path":"/usr/bin/bash","maxInstancesByPhase":[1,0,1,0]},"runtimeNode":{"path":"/opt/node/bin/node","maxInstancesByPhase":[1,1,1,1]},"listener":{"path":"/opt/runner/bin/Runner.Listener","maxInstancesByPhase":[0,1,1,1]},"worker":{"path":"/opt/runner/bin/Runner.Worker","maxInstancesByPhase":[0,0,1,1]},"pluginHost":{"path":"/opt/runner/bin/Runner.PluginHost","maxInstancesByPhase":[0,0,1,1]},"actionNode":{"path":"/opt/runner/externals/node24/bin/node","maxInstancesByPhase":[0,0,1,1]},"git":{"path":"/usr/bin/git","maxInstancesByPhase":[0,0,1,0]},"gitRemoteHttps":{"path":"/usr/lib/git-core/git-remote-https","maxInstancesByPhase":[0,0,1,0]}}}'
    )
  );
});

test('freezes accounting, authority mode, supply chain, and retention', () => {
  assert.deepEqual(
    policy.networkAccounting,
    fromJson(
      '{"family":"inet","table":"baci_cwv_measurement","classifyChain":"classify","classifyHook":"forward","classifyPriority":-150,"ingressChain":"external_ingress","ingressHook":"forward","hostIngressChain":"host_external_ingress","hostIngressHook":"input","egressChain":"external_egress","hostEgressChain":"host_external_egress","egressHook":"postrouting","counterPriority":0,"markPrefix":2952790016,"markHashBits":28}'
    )
  );
  assert.equal(policy.host.sharedHostException.approved, true);
  assert.deepEqual(policy.repositoryAuthority, {
    mode: 'personal-public-exact-run',
    approved: true,
    approvedOn: '2026-07-20',
    workflowPath: '.github/workflows/cwv-runner-attestation.yml',
    workflowRef: 'refs/heads/main',
    hookTimeoutSeconds: 5,
    admissionChallengeTtlSeconds: 30,
    inventoryReceiptTtlSeconds: 5,
    queueDeadlineSeconds: 120,
    listenerHoldTimeoutSeconds: 120,
    controllerTimeoutSeconds: 1200,
    watchdogTimeoutSeconds: 1800,
    artifactDownload: {
      hostPattern: '^productionresultssa[0-9]+\\.blob\\.core\\.windows\\.net$',
      pathPrefix: '/actions-results/',
      allowedQueryKeys: [
        'rscd',
        'rsct',
        'se',
        'sig',
        'ske',
        'skoid',
        'sks',
        'skt',
        'sktid',
        'skv',
        'sp',
        'spr',
        'sr',
        'st',
        'sv',
      ],
      maxBytes: 1048576,
      connectTimeoutSeconds: 10,
      headerTimeoutSeconds: 10,
      bodyInactivityTimeoutSeconds: 10,
      overallTimeoutSeconds: 30,
    },
  });
  assert.deepEqual(
    policy.workflowActions,
    fromJson(
      '{"checkout":"actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1","uploadArtifact":"actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02","downloadArtifact":"actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0","createGithubAppToken":"actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1"}'
    )
  );
  assert.deepEqual(
    policy.ruleset,
    fromJson(
      '{"name":"ogabassey-rollout-progress-immutable","target":"tag","enforcement":"active","tagIncludes":["refs/tags/ogabassey-rollout-claim/*","refs/tags/ogabassey-rollout-progress/**/*","refs/tags/ogabassey-semantic-admission/*"],"tagExcludes":[],"rules":["update","deletion"],"bypassActors":[]}'
    )
  );
  const word = createHash('sha256')
    .update('campaign-001')
    .digest()
    .readUInt32BE(0);
  assert.equal((policy.networkAccounting.markPrefix & 0x0fffffff) >>> 0, 0);
  assert.equal(
    (policy.networkAccounting.markPrefix | (word & 0x0fffffff)) >>> 0,
    3068019630
  );
  assert.deepEqual(
    (() => {
      const {
        ownerDarwinArm64Url: _ownerDarwinArm64Url,
        ownerDarwinArm64Sha256: _ownerDarwinArm64Sha256,
        ...linuxNode
      } = policy.supplyChain.node;
      return { ...policy.supplyChain, node: linuxNode };
    })(),
    fromJson(
      '{"ubuntu":{"reference":"ubuntu@sha256:4fbb8e6a8395de5a7550b33509421a2bafbc0aab6c06ba2cef9ebffbc7092d90","snapshotId":"20260720T000000Z","architecture":"amd64","signedBy":"/usr/share/keyrings/ubuntu-archive-keyring.gpg","sources":[{"uri":"https://archive.ubuntu.com/ubuntu","suites":["noble","noble-updates"],"components":["main","universe","restricted","multiverse"]},{"uri":"https://security.ubuntu.com/ubuntu","suites":["noble-security"],"components":["main","universe","restricted","multiverse"]}]},"runner":{"version":"2.335.1","url":"https://github.com/actions/runner/releases/download/v2.335.1/actions-runner-linux-x64-2.335.1.tar.gz","sha256":"4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf","allowedFinalOrigins":["https://github.com","https://release-assets.githubusercontent.com"],"commandSettingsUrl":"https://raw.githubusercontent.com/actions/runner/v2.335.1/src/Runner.Listener/CommandSettings.cs","commandSettingsSha256":"937f6552579f7d1eeb0a6d0201586781eb3e2e5ea2ab3878429076560e0cab08","commandSettingsAllowedFinalOrigins":["https://raw.githubusercontent.com"]},"node":{"version":"24.18.0","url":"https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-x64.tar.xz","sha256":"55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742","allowedFinalOrigins":["https://nodejs.org"]},"pnpm":{"version":"11.7.0","url":"https://registry.npmjs.org/pnpm/-/pnpm-11.7.0.tgz","sha256":"deafa7ec98a1218b6a047289b92fbe2395c1e22d3495bb711653013218ee15ee","integrity":"sha512-GcyFLBIMcSV2DyRD7mvgyltA+fUFmN4aCaHxd1A+AQ5Xwjx3ZG4B52HeWb+HT7IqM5jDOrlpH8E+uUa28PTWIA==","allowedFinalOrigins":["https://registry.npmjs.org"]},"chrome":{"version":"150.0.7871.128-1","url":"https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_150.0.7871.128-1_amd64.deb","sha256":"83ed59c85878ebb8fa53915ebe7066cafc58d1c04c1c95449486e6f9d99a1efb","allowedFinalOrigins":["https://dl.google.com"]}}'
    )
  );
  assert.equal(
    policy.supplyChain.node.ownerDarwinArm64Url,
    'https://nodejs.org/dist/v24.18.0/node-v24.18.0-darwin-arm64.tar.xz'
  );
  assert.equal(
    policy.supplyChain.node.ownerDarwinArm64Sha256,
    '4477b9f78efb77744cf5eb57a0e9594dba66466b38b4e93fa9f35cb907a095a6'
  );
  assert.equal(policy.artifactRetentionDays, 90);
});

test('derives the frozen unsigned campaign mark from the transaction id', () => {
  assert.equal(deriveCampaignMark('campaign-001'), 3068019630);
  assert.equal(deriveCampaignMark('campaign-001').toString(16), 'b6de43ae');
  assert.throws(() => deriveCampaignMark(''), /invalid transaction id/);
});

test('freezes pnpm and every provenance linkage', () => {
  assert.deepEqual(policy.supplyChain.pnpm, {
    version: '11.7.0',
    url: 'https://registry.npmjs.org/pnpm/-/pnpm-11.7.0.tgz',
    sha256: 'deafa7ec98a1218b6a047289b92fbe2395c1e22d3495bb711653013218ee15ee',
    integrity:
      'sha512-GcyFLBIMcSV2DyRD7mvgyltA+fUFmN4aCaHxd1A+AQ5Xwjx3ZG4B52HeWb+HT7IqM5jDOrlpH8E+uUa28PTWIA==',
    allowedFinalOrigins: ['https://registry.npmjs.org'],
  });
  assert.equal(policy.supplyChainProvenance.runner.assetId, 442283019);
  assert.equal(
    policy.supplyChain.runner.sha256,
    '4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf'
  );
  assert.equal(
    policy.supplyChainProvenance.runner.assetDigest,
    'sha256:4ef2f25285f0ae4477f1fe1e346db76d2f3ebf03824e2ddd1973a2819bf6c8cf'
  );
  assert.equal(
    policy.supplyChainProvenance.runner.assetDigest,
    `sha256:${policy.supplyChain.runner.sha256}`
  );
  assert.equal(
    policy.supplyChainProvenance.node.checksumsSha256,
    '3927bab574a00ca0560c9583fe19655ba19603a1c5851414e4325d34ac50e469'
  );
  assert.equal(
    policy.supplyChainProvenance.node.keyringSha256,
    '8e6f89521a0694e445f42decd022f48369c634f1b5bcb5975135b69c88629ae8'
  );
  assert.equal(
    policy.supplyChainProvenance.pnpm.distShasum,
    'bea54364524dadf0a42dae28dbfeeab25ff177e5'
  );
  assert.equal(
    policy.supplyChainProvenance.chrome.packagesSha256,
    'e46bfc093b1b728d0e7a6e5419b90be8672f9b113ddaf50b21a910f40c583173'
  );
  assert.equal(
    policy.supplyChainProvenance.ownerCli.binarySha256,
    'a38e8ea1b9794a445a1ce746392e36111ca00a3242a6447b49cd4c162cb191a7'
  );
});

test('rejects security-relevant policy relaxations', () => {
  const cases = [
    ['/runner/labels', [...policy.runner.labels, 'second-measurement']],
    ['/resources/otherCpuSet', '1-2'],
    ['/resources/memorySwapBytes', 1],
    ['/resources/shmBytes', 1073741825],
    ['/installationImport/cpuQuotaPercent', 101],
    ['/installationImport/memoryBytes', 2147483649],
    ['/installationImport/memorySwapBytes', 1],
    ['/installationImport/pidsLimit', 257],
    ['/installationImport/ioWeight', 11],
    ['/installationImport/sampleSeconds', 3],
    [
      '/installationImport/workerServices',
      'docker.service|baci-cwv-containerd.service',
    ],
    ['/dedicatedRuntime/dockerSocket', 'tcp://localhost'],
    ['/dedicatedRuntime/daemonIptables', true],
    ['/dedicatedRuntime/daemonIpForward', true],
    ['/dedicatedRuntime/daemonIpMasq', true],
    ['/dedicatedRuntime/enableIpv6', true],
    ['/dedicatedRuntime/requiredHostIpv4Forward', 0],
    ['/dedicatedRuntime/registrationProbeTimeoutSeconds', 11],
    ['/networkAccounting/hostIngressChain', 'other'],
    ['/artifactRetentionDays', 89],
    ['/thresholds/load1Max', 0.6],
    ['/host/sharedHostException/approved', false],
    ['/repositoryAuthority/mode', 'hosted'],
    ['/repositoryAuthority/approved', false],
    ['/repositoryAuthority/workflowPath', 'other.yml'],
    ['/repositoryAuthority/workflowRef', 'refs/heads/other'],
    ['/repositoryAuthority/hookTimeoutSeconds', 6],
    ['/repositoryAuthority/admissionChallengeTtlSeconds', 31],
    ['/repositoryAuthority/inventoryReceiptTtlSeconds', 6],
    ['/repositoryAuthority/queueDeadlineSeconds', 121],
    ['/repositoryAuthority/listenerHoldTimeoutSeconds', 121],
    ['/repositoryAuthority/controllerTimeoutSeconds', 1201],
    ['/repositoryAuthority/watchdogTimeoutSeconds', 1801],
    ['/repositoryAuthority/artifactDownload/hostPattern', '.*'],
    ['/repositoryAuthority/artifactDownload/pathPrefix', '/'],
    ['/repositoryAuthority/artifactDownload/maxBytes', 1048577],
    ['/host/owner', undefined, 'delete'],
    ['/host/alertDestination', undefined, 'delete'],
    ['/hostedFallback', true],
    ['/imageTag', 'latest'],
    ['/host/apiToken', 'not-a-real-secret'],
  ];
  for (const [pointer, value, operation] of cases) {
    assert.throws(
      () => parseRunnerPolicy(mutate(pointer, value, operation)),
      /invalid runner policy/,
      pointer
    );
  }
});
