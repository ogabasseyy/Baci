import http.client
import socket
import ssl
import subprocess
from types import MappingProxyType

from treasury_owner_contract import Refused


_REFUSAL_CODES = MappingProxyType({
    'Root-private owner execution required': 'OWNER_ROOT_REQUIRED',
    'Unsafe owner entry point': 'OWNER_ENTRYPOINT_REFUSED',
    'Nginx activation requires private service startup': 'NGINX_START_REQUIRED',
    'Private directory metadata refused': 'PRIVATE_DIRECTORY_METADATA_REFUSED',
    'Root-owned ancestors required': 'ROOT_ANCESTORS_REFUSED',
    'Input file metadata refused': 'INPUT_FILE_METADATA_REFUSED',
    'Input file changed during read': 'INPUT_FILE_CHANGED',
    'Input file unavailable': 'INPUT_FILE_UNAVAILABLE',
    'Nginx installation requires root owner': 'NGINX_ROOT_REQUIRED',
    'Nginx approval expired': 'NGINX_APPROVAL_EXPIRED',
    'Nginx enabled site identity refused': 'NGINX_ENABLED_SITE_IDENTITY_REFUSED',
    'Nginx file identity changed': 'NGINX_FILE_IDENTITY_CHANGED',
    'Nginx pinned site unavailable': 'NGINX_PINNED_SITE_UNAVAILABLE',
    'Nginx predecessor changed during preparation': 'NGINX_PREDECESSOR_CHANGED',
    'Repeated Nginx installation refused': 'NGINX_REPEATED_INSTALLATION_REFUSED',
    'Nginx observed predecessor size changed': 'NGINX_PREDECESSOR_SIZE_CHANGED',
    'Nginx token shape refused': 'NGINX_TOKEN_SHAPE_REFUSED',
    'Nginx requires exactly one server block': 'NGINX_SERVER_BLOCK_COUNT_REFUSED',
    'Nginx unnamed block refused': 'NGINX_UNNAMED_BLOCK_REFUSED',
    'Nginx top-level scope refused': 'NGINX_TOP_LEVEL_SCOPE_REFUSED',
    'Nginx nested server refused': 'NGINX_NESTED_SERVER_REFUSED',
    'Nginx location scope refused': 'NGINX_LOCATION_SCOPE_REFUSED',
    'Nginx shared, wildcard or duplicate location refused': 'NGINX_LOCATION_CONFLICT',
    'Nginx fallback must stay disabled': 'NGINX_FALLBACK_NOT_DISABLED',
    'Nginx block shape refused': 'NGINX_BLOCK_SHAPE_REFUSED',
    'Nginx named gateway fallback differs': 'NGINX_NAMED_FALLBACK_MISMATCH',
    'Nginx managed gateway root differs': 'NGINX_MANAGED_GATEWAY_ROOT_MISMATCH',
    'Nginx directive scope refused': 'NGINX_DIRECTIVE_SCOPE_REFUSED',
    'Nginx server identity refused': 'NGINX_SERVER_IDENTITY_REFUSED',
    'Existing public checkout route refused': 'NGINX_CHECKOUT_ALREADY_PRESENT',
    'Nginx single-server shape refused': 'NGINX_SINGLE_SERVER_SHAPE_REFUSED',
    'Nginx input or reviewed pin refused': 'NGINX_INPUT_OR_PIN_REFUSED',
    'Nginx predecessor digest changed': 'NGINX_PREDECESSOR_DIGEST_CHANGED',
    'Public HTTP staging deadline expired': 'HTTP_DEADLINE_EXPIRED',
    'Public HTTP response exceeds limit': 'HTTP_RESPONSE_TOO_LARGE',
    'Public HTTP status differs': 'HTTP_STATUS_MISMATCH',
    'Public HTTP JSON contract differs': 'HTTP_JSON_CONTRACT_MISMATCH',
})

_EXCEPTION_CLASSES = MappingProxyType({
    Refused: 'Refused',
    OSError: 'OSError',
    TimeoutError: 'TimeoutError',
    ConnectionRefusedError: 'ConnectionRefusedError',
    ConnectionResetError: 'ConnectionResetError',
    FileNotFoundError: 'FileNotFoundError',
    PermissionError: 'PermissionError',
    BlockingIOError: 'BlockingIOError',
    InterruptedError: 'InterruptedError',
    socket.gaierror: 'gaierror',
    ssl.SSLError: 'SSLError',
    ssl.SSLCertVerificationError: 'SSLCertVerificationError',
    http.client.HTTPException: 'HTTPException',
    http.client.RemoteDisconnected: 'RemoteDisconnected',
    subprocess.TimeoutExpired: 'TimeoutExpired',
    subprocess.CalledProcessError: 'CalledProcessError',
    UnicodeDecodeError: 'UnicodeDecodeError',
    ValueError: 'ValueError',
    TypeError: 'TypeError',
    RuntimeError: 'RuntimeError',
})


def public_owner_diagnostic(error: BaseException) -> dict[str, str]:
    reason = 'UNEXPECTED_EXCEPTION'
    if type(error) is Refused:
        reason = 'UNCLASSIFIED_REFUSAL'
        if len(error.args) == 1 and type(error.args[0]) is str:
            reason = _REFUSAL_CODES.get(error.args[0], reason)
    return {
        'reasonCode': reason,
        'exceptionClass': _EXCEPTION_CLASSES.get(type(error), 'Exception'),
    }
