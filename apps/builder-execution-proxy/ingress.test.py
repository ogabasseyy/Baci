"""Run the candidate against a temporary HTTPS listener and synthetic backend."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time

UPSTREAM = 'builder-output-origin.usebaci.com'
EXECUTION = 'baci-builder-output.ogabassey-ai.workers.dev'
PATH = '/resource/' + 'b' * 64 + '/index.html'
KEY = 's' * 43
KEY_HEADER = 'X-Baci-Execution-Origin-Key'
CADDY = os.environ.get('BACI_TEST_CADDY', 'caddy')


def check_worker_caddy_boundary(caddy_port, published):
    subprocess.run([
        'node', '--input-type=module', '-e', r"""
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const [workerUrl, port, execution, published, key] = process.argv.slice(1);
const { default: worker } = await import(workerUrl);
const boundary = '%2F%5Ba%5D'.repeat(256);
let forwarded = 0;
globalThis.fetch = (url, options) => {
  forwarded++;
  assert.equal(url.search, '?path=' + boundary);
  const result = execFileSync('curl', [
    '-ksS', '--noproxy', '*', '--max-time', '2',
    '--resolve', `${url.hostname}:${port}:127.0.0.1`,
    '-H', 'X-Baci-Execution-Origin-Key: ' +
      options.headers.get('x-baci-execution-origin-key'),
    '-w', '\n%{http_code}', `https://${url.hostname}:${port}${url.pathname}${url.search}`,
  ], { encoding: 'utf8' });
  const end = result.lastIndexOf('\n');
  return new Response(result.slice(0, end), {
    status: Number(result.slice(end + 1)),
    headers: { 'content-type': 'text/html', 'content-security-policy': 'sandbox allow-scripts' },
  });
};
const url = `https://${execution}${published}/index.html?path=`;
const env = { EXECUTION_ORIGIN_KEY: key };
const accepted = await worker.fetch(new Request(url + boundary.toLowerCase()), env);
assert.equal(accepted.status, 200);
assert.equal((await accepted.json()).path, published + '/index.html?path=' + boundary);
assert.equal((await worker.fetch(new Request(url + boundary + 'a'), env)).status, 404);
assert.equal(forwarded, 1);
const staleKey = { EXECUTION_ORIGIN_KEY: 'r'.repeat(43) };
const rejected = await worker.fetch(new Request(url + boundary), staleKey);
assert.equal(rejected.status, 404);
assert.equal(await rejected.text(), '');
assert.equal(forwarded, 2);
assert.equal((await worker.fetch(new Request(url + boundary), {})).status, 503);
assert.equal(forwarded, 2);
""", Path(__file__).resolve().with_name('worker.mjs').as_uri(),
        str(caddy_port), EXECUTION, published, KEY,
    ], check=True)


class Backend(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps({
            'path': self.path,
            'host': self.headers.get('Host'),
            'origin': self.headers.get('Origin'),
            'cookie': self.headers.get('Cookie'),
            'referer': self.headers.get('Referer'),
            'authorization': self.headers.get('Authorization'),
            'key': self.headers.get(KEY_HEADER),
            'forwarded': {
                name: self.headers.get(name)
                for name in ('Forwarded', 'X-Forwarded-For',
                             'X-Forwarded-Host', 'X-Forwarded-Proto')
            },
        }).encode())

    def log_message(self, *_args):
        pass


def smoke(root, backend_port, secret, dead=False):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        caddy_port = sock.getsockname()[1]
    candidate = Path(__file__).with_name('Caddyfile.candidate').read_text()
    config = root / 'Caddyfile'
    config.write_text(
        candidate.replace('\n{\n', '\n{\n admin off\n auto_https disable_redirects\n'
                          ' skip_install_trust\n default_bind 127.0.0.1\n', 1)
        # Deliberately enable access logging to model an operator adding log.
        .replace(f'{UPSTREAM} {{', f'https://{UPSTREAM}:{caddy_port} {{\n tls internal\n log')
    )
    env = dict(os.environ, XDG_CONFIG_HOME=str(root), XDG_DATA_HOME=str(root),
               BACI_DELIVERY_PORT=str(backend_port), BACI_EXECUTION_ORIGIN_KEY=secret)

    adapted = subprocess.run(
        [CADDY, 'adapt', '--config', str(config), '--adapter', 'caddyfile'],
        env=env, capture_output=True, text=True, check=True,
    )
    assert KEY not in adapted.stdout and KEY not in adapted.stderr

    def request(path, *args):
        return subprocess.run([
            'curl', '-ksS', '--noproxy', '*', '--max-time', '2',
            '--resolve', f'{UPSTREAM}:{caddy_port}:127.0.0.1',
            '-w', '\n%{http_code}', *args, f'https://{UPSTREAM}:{caddy_port}{path}',
        ], capture_output=True, text=True).stdout.rsplit('\n', 1)

    with (root / 'caddy.log').open('w+') as log:
        process = subprocess.Popen([CADDY, 'run', '--config', str(config)],
                                   env=env, stdout=log, stderr=log)
        try:
            for _ in range(100):
                if process.poll() is not None:
                    log.seek(0)
                    raise RuntimeError(log.read())
                if request(PATH)[-1] == '404':
                    break
                time.sleep(.05)
            else:
                raise RuntimeError('Synthetic Caddy never became ready')

            assert request(PATH, '-H', f'{KEY_HEADER}: incorrect')[-1] == '404'
            if dead:
                referer = 'synthetic-reference-sensitive'
                assert request(PATH, '-H', f'{KEY_HEADER}: {KEY}',
                               '-H', f'Referer: https://usebaci.com/?value={referer}')[-1] == '502'
                log.seek(0)
                runtime = [json.loads(line) for line in log if line.startswith('{')]
                failures = [record for record in runtime if record.get('logger') == 'http.log.error']
                assert failures, 'Expected dead-upstream runtime error logging'
                assert all('headers' not in event['request'] and 'uri' not in event['request']
                           for event in failures)
                logs = json.dumps(runtime)
                assert all(marker not in logs for marker in (KEY, PATH, referer))
                return
            body, status = request(PATH, '-H', f'{KEY_HEADER}: {KEY}',
                                   '-H', 'Origin: null', '-H', 'Cookie: sensitive=x',
                                   '-H', 'Authorization: Bearer sensitive',
                                   '-H', 'Forwarded: for=192.0.2.1',
                                   '-H', 'X-Forwarded-For: 192.0.2.1',
                                   '-H', 'X-Forwarded-Host: example.invalid',
                                   '-H', 'X-Forwarded-Proto: http',
                                   '-H', 'Referer: https://usebaci.com/?value=synthetic')
            if not secret:
                assert status == '404'
                return
            assert status == '200'
            assert json.loads(body) == {
                'path': PATH, 'host': EXECUTION, 'origin': 'null', 'cookie': None,
                'authorization': None, 'key': None, 'referer': None,
                'forwarded': dict.fromkeys(('Forwarded', 'X-Forwarded-For',
                                            'X-Forwarded-Host', 'X-Forwarded-Proto')),
            }
            assert request('/internal/owner/preview', '-H', f'{KEY_HEADER}: {KEY}')[-1] == '404'
            assert request(PATH, '-H', f'{KEY_HEADER}: {KEY}', '-X', 'POST')[-1] == '404'
            published = '/published/example/' + 'a' * 64
            published_route = published + '/index.html?path=%2Fproducts%2F%5Bsample%5D'
            body, status = request(published_route, '-H', f'{KEY_HEADER}: {KEY}')
            assert status == '200'
            assert json.loads(body)['path'] == published_route
            assert request(published + '/index.html?path=%2F' + 'a' * 1023,
                           '-H', f'{KEY_HEADER}: {KEY}')[-1] == '200'
            for encoded in ('%2Fa' * 512, '%2F%5Ba%5D' * 256):
                boundary = published + '/index.html?path=' + encoded
                assert request(boundary, '-H', f'{KEY_HEADER}: {KEY}')[-1] == '200'
                assert request(boundary + 'a', '-H', f'{KEY_HEADER}: {KEY}')[-1] == '404'
            check_worker_caddy_boundary(caddy_port, published)
            for query in (
                '?unrecognized=1',
                '?path=%2fproducts%2F%5bsample%5D',
                '?path=%2F&path=%2Fproducts',
                '?path=%2Fproducts%2F',
                '?path=%2F' + 'a' * 1024,
            ):
                assert request(published + '/index.html' + query, '-H',
                               f'{KEY_HEADER}: {KEY}')[-1] == '404'
            assert request(PATH + '?path=%2F', '-H', f'{KEY_HEADER}: {KEY}')[-1] == '404'
            assert request(published + '/app.js?path=%2F', '-H',
                           f'{KEY_HEADER}: {KEY}')[-1] == '404'
            for malformed in (
                '/resource/invalid/index.html',
                '/resource/' + 'b' * 64 + '/other.js',
                '/published/example/invalid/app.js',
            ):
                assert request(malformed, '-H', f'{KEY_HEADER}: {KEY}')[-1] == '404'
        finally:
            process.terminate()
            process.wait(timeout=10)
            log.seek(0)
            runtime = [json.loads(line) for line in log if line.startswith('{')]
            assert not any(event.get('logger', '').startswith('http.log.access')
                           for event in runtime), 'Output vhost emitted an access record'


def main():
    with ThreadingHTTPServer(('127.0.0.1', 0), Backend) as backend:
        threading.Thread(target=backend.serve_forever, daemon=True).start()
        try:
            for secret in (KEY, ''):
                with tempfile.TemporaryDirectory(prefix='baci-output-ingress-') as directory:
                    smoke(Path(directory), backend.server_port, secret)
        finally:
            backend.shutdown()
    with socket.socket() as dead:
        dead.bind(('127.0.0.1', 0))
        dead_port = dead.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix='baci-output-dead-') as directory:
        smoke(Path(directory), dead_port, KEY, dead=True)
    print('Synthetic execution HTTPS, access-log suppression and runtime redaction passed.')


if __name__ == '__main__':
    main()
