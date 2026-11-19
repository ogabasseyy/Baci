"""Loopback-only staging relay. A separately approved tunnel may expose this port.

Only health and the authenticated Oxygen webhook are forwarded. No cookies,
storefront pages, general API routes or credentials are logged.
"""
import http.client
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PATH = '/api/payments/oxygen/webhook'
LIMIT = 262144


def forward(body, headers):
    connection = http.client.HTTPConnection('127.0.0.1', 3000, timeout=120)
    try:
        connection.request('POST', PATH, body, headers)
        response = connection.getresponse()
        data = response.read(LIMIT + 1)
        if len(data) > LIMIT:
            raise ValueError('Response too large')
        return response.status, data
    finally:
        connection.close()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def reply(self, status, body):
        if not isinstance(body, bytes):
            body = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/health':
            return self.reply(200, {'ready': True, 'environment': 'staging'})
        self.reply(404, {'error': 'Not found'})

    def do_POST(self):
        if self.path != PATH:
            return self.reply(404, {'error': 'Not found'})
        if self.headers.get('Transfer-Encoding'):
            return self.reply(400, {'error': 'Content length required'})
        if self.headers.get_content_type() != 'application/json':
            return self.reply(415, {'error': 'JSON required'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= LIMIT:
                return self.reply(413, {'error': 'Invalid body size'})
            body = self.rfile.read(length)
            if len(body) != length:
                return self.reply(400, {'error': 'Incomplete body'})
            headers = {'Content-Type': 'application/json'}
            for key in ['api_key', 'api_secret', 'Authorization']:
                if self.headers.get(key):
                    headers[key] = self.headers[key]
            status, data = forward(body, headers)
            self.reply(status, data)
        except Exception:
            self.reply(503, {'error': 'Callback unavailable'})


if __name__ == '__main__':
    print('Callback-only staging relay on 127.0.0.1:3457. No public tunnel started.', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 3457), Handler).serve_forever()
