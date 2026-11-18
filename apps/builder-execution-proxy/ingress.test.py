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


class Backend(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps({
            'path': self.path,
            'host': self.headers.get('Host'),
            'origin': self.headers.get('Origin'),
            'cookie': self.headers.get('Cookie'),
            'authorization': self.headers.get('Authorization'),
            'key': self.headers.get(KEY_HEADER),
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
        .replace(f'{UPSTREAM} {{', f'https://{UPSTREAM}:{caddy_port} {{\n tls internal')
    )
    env = dict(os.environ, XDG_CONFIG_HOME=str(root), XDG_DATA_HOME=str(root),
               BACI_DELIVERY_PORT=str(backend_port), BACI_EXECUTION_ORIGIN_KEY=secret)

    adapted = subprocess.run(
        ['caddy', 'adapt', '--config', str(config), '--adapter', 'caddyfile'],
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
        process = subprocess.Popen(['caddy', 'run', '--config', str(config)],
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
                                   '-H', 'Authorization: Bearer sensitive')
            if not secret:
                assert status == '404'
                return
            assert status == '200'
            assert json.loads(body) == {
                'path': PATH, 'host': EXECUTION, 'origin': 'null', 'cookie': None,
                'authorization': None, 'key': None,
            }
            assert request('/internal/owner/preview', '-H', f'{KEY_HEADER}: {KEY}')[-1] == '404'
            assert request(PATH, '-H', f'{KEY_HEADER}: {KEY}', '-X', 'POST')[-1] == '404'
            for malformed in (
                '/resource/invalid/index.html',
                '/resource/' + 'b' * 64 + '/other.js',
                '/published/example/invalid/app.js',
            ):
                assert request(malformed, '-H', f'{KEY_HEADER}: {KEY}')[-1] == '404'
        finally:
            process.terminate()
            process.wait(timeout=10)


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
    print('Synthetic execution HTTPS upstream and runtime log checks passed.')


if __name__ == '__main__':
    main()
