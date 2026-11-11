import {
  bundleSource,
  unpackPrivateBuild,
} from './tools/experience-runner/bundle-source.mjs';

let data = '';
for await (const chunk of process.stdin) {
  data += chunk;
  if (Buffer.byteLength(data) > 8 * 1024 * 1024) throw Error('Input budget');
}
const input = JSON.parse(data);
const privateInput = unpackPrivateBuild(input);
console.log(
  JSON.stringify(
    await (privateInput
      ? bundleSource(privateInput.manifest, {
          mountComponent: true,
          hostOrigin: privateInput.hostOrigin,
          profile: privateInput.profile,
          previewOrigin: privateInput.previewOrigin,
        })
      : bundleSource(input))
  )
);
