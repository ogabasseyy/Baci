import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIGEST = /^[a-f0-9]{64}$/;
const fail = () => {
  throw new TypeError('invalid Task 9 composer');
};
const descriptorBytes = (fd, size) => {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(fd, bytes, offset, size - offset, offset);
    if (!count) fail();
    offset += count;
  }
  return bytes;
};
const EXPECTED = Object.freeze({
  'canonical-json.mjs':
    'b65fea46e65c67b8f1e85da9c851e2170536f05b236445de5d481bb9ec97124c',
  'git-ref-validator.mjs':
    '2c8d8fdbad3a83fe2daa94205c6ce4461692350e3b76ab6979ca2f3b91b4872b',
  'source-archive.mjs':
    'c0db315f3f86cd82f396531a30fe074a0b35824aa6b2e9c76e7ce07f720d1842',
  'source-manifest-git.mjs':
    'd98121631c20f8eea61490cff5e6f593748e930d792f5551a5317490d980bc02',
  'source-manifest-objects.mjs':
    'c4085ab23f7090c2da256dd2f66f7ca0bd28afb5b00458527f1c98c504f23d81',
  'source-manifest-tree.mjs':
    '713f0bfd672807f3d94488917df78022e9793d9e2cfdeb68ebf9b59dec46b321',
  'source-manifest.mjs':
    '241af37ada8179b2db5144a9a3eafc03b3db78d1d1f53b35cc0e2286f309043c',
  'task9-authority-receipt.mjs':
    '703424cafb594b4d1a5050578969f84bbf50e1b5ca2c4fd032dac2dbda947c04',
  'task9-bootstrap-bundle-cli.mjs':
    '41c382acfda054cad568ec90fee4eeac0da6f31984c09b9d51cdc0a14668a050',
  'task9-bootstrap-bundle.mjs':
    'fa7335f9e10ebcc0d8083c4d276d2b356cb245a0517e7f39ed1740d72a04e4eb',
  'task9-bootstrap-identity.mjs':
    '291bdcca92a628c77dc81fe9c7cd8c1416858e16dd3d9936ccbed36697e28017',
  'task9-bootstrap-provenance.mjs':
    'ed6c3b124eecb7980d699e99335102ca53b155300ec21bfdf89fcc612634db8c',
  'task9-bootstrap.mjs':
    '332b6749e41a94a71be3c32c3e8c3de6388bba14a180dbd676b9ffde81e9d504',
  'task9-fsync-directory.mjs':
    '8a2b37a92184b89f0f16388e1abe5a0ba1940c39f8b914fb55d382c4bc810b2b',
  'task9-held-checkout.mjs':
    '2597914a9fcf3c83628aa3175c689ca6e37b1b4abfc81ea2c019bf0ddfd941a1',
  'task9-held-file.mjs':
    'c73b6749437c45794899fe469201715643f00765e05c020aa8b287585227af0f',
  'task9-node-archive.mjs':
    'd12b28d1f84fe2247c527cf9ec94e98069a575d54048f8ce2b2a1ebcf5d17a31',
  'task9-output-directory.mjs':
    '65d5846c9dae2ada24daa3c3fed082008e15664f2fef9cc2d9e17c5f66c5f827',
  'task9-pr-metadata.mjs':
    '6d88de69cf5479fe5d49d09ee59cc4ebaef8f9f531630bc031c45de304c608e0',
  'task9-published-files.mjs':
    '6b99c7292def0551ff16b81afa46500bc1b662d6f5593125750d1db8aa42ca59',
});

function immutableModule(name, root, cache = new Map()) {
  if (cache.has(name)) return cache.get(name);
  const expected = EXPECTED[name];
  if (!expected) fail();
  let source = readFileSync(join(root, name), 'utf8');
  if (createHash('sha256').update(source).digest('hex') !== expected) fail();
  source = source.replaceAll(
    'fileURLToPath(import.meta.url)',
    JSON.stringify(join(root, name))
  );
  const imports = [...source.matchAll(/from\s+(['"])(\.\/[^'"]+)\1/g)];
  for (const match of imports) {
    const child = match[2].slice(2);
    source = source.replace(
      match[0],
      `from ${match[1]}${immutableModule(child, root, cache)}${match[1]}`
    );
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  cache.set(name, url);
  return url;
}

export async function runTask9BootstrapBundleLauncher({
  composerPath,
  composerSha256,
  githubPath,
  githubSha256,
  argv,
  cwd,
}) {
  if (
    typeof composerPath !== 'string' ||
    typeof cwd !== 'string' ||
    typeof githubPath !== 'string' ||
    !Array.isArray(argv) ||
    !DIGEST.test(composerSha256 ?? '') ||
    !DIGEST.test(githubSha256 ?? '')
  )
    fail();
  const composer = realpathSync(composerPath);
  if (realpathSync(cwd) !== realpathSync(join(dirname(composer), '../..')))
    fail();
  if (
    composer !==
    join(realpathSync(cwd), 'infra/cwv-runner/task9-bootstrap-bundle-cli.mjs')
  )
    fail();
  const bytes = readFileSync(composer);
  if (createHash('sha256').update(bytes).digest('hex') !== composerSha256)
    fail();
  const github = realpathSync(githubPath);
  let githubFd;
  try {
    githubFd = openSync(
      github,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
  } catch {
    fail();
  }
  const githubIdentity = fstatSync(githubFd);
  const currentGithub = lstatSync(github);
  if (
    !githubIdentity.isFile() ||
    currentGithub.isSymbolicLink() ||
    !currentGithub.isFile() ||
    currentGithub.dev !== githubIdentity.dev ||
    currentGithub.ino !== githubIdentity.ino ||
    createHash('sha256')
      .update(descriptorBytes(githubFd, githubIdentity.size))
      .digest('hex') !== githubSha256
  ) {
    closeSync(githubFd);
    fail();
  }
  const verifyGithub = (endpoint) => {
    const before = lstatSync(github);
    if (
      before.isSymbolicLink() ||
      before.dev !== githubIdentity.dev ||
      before.ino !== githubIdentity.ino ||
      createHash('sha256')
        .update(descriptorBytes(githubFd, githubIdentity.size))
        .digest('hex') !== githubSha256
    )
      fail();
    const output = execFileSync(github, ['api', endpoint], {
      encoding: 'utf8',
      timeout: 120_000,
      env: { HOME: process.env.HOME, PATH: '/usr/bin:/bin' },
    });
    const after = lstatSync(github);
    if (
      after.isSymbolicLink() ||
      after.dev !== githubIdentity.dev ||
      after.ino !== githubIdentity.ino ||
      createHash('sha256')
        .update(descriptorBytes(githubFd, githubIdentity.size))
        .digest('hex') !== githubSha256
    )
      fail();
    return JSON.parse(output);
  };
  try {
    const module = await import(
      immutableModule('task9-bootstrap-bundle-cli.mjs', dirname(composer))
    );
    if (typeof module.runTask9BootstrapBundleCli !== 'function') fail();
    return module.runTask9BootstrapBundleCli(argv, { verifyGithub });
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message === 'invalid Task 9 bundle invocation'
    )
      throw error;
    throw error;
  } finally {
    closeSync(githubFd);
  }
}

try {
  if (
    process.argv[1] &&
    realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
  ) {
    const [
      composerPath,
      composerSha256,
      githubPath,
      githubSha256,
      cwd,
      ...argv
    ] = process.argv.slice(2);
    const output = await runTask9BootstrapBundleLauncher({
      composerPath,
      composerSha256,
      githubPath,
      githubSha256,
      cwd,
      argv,
    });
    process.stdout.write(`${output}\n`);
  }
} catch {
  process.stderr.write('task9-bootstrap-bundle-launcher refused\n');
  process.exitCode = 1;
}
