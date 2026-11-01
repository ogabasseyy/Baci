#!/usr/bin/env python3
"""Make an isolated test-channel copy of a verified native Expo plist."""

import argparse
import plistlib
import re
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--runtime', required=True)
    parser.add_argument('--channel', required=True)
    parser.add_argument('--source-channel', required=True)
    parser.add_argument('--updates-url', required=True)
    args = parser.parse_args()

    if not re.fullmatch(r'\d+\.\d+\.\d+', args.runtime):
        parser.error('A dotted numeric runtime version is required.')
    if len(args.channel) > 64 or not re.fullmatch(r'ota-test-[a-z0-9]+(?:-[a-z0-9]+)*', args.channel):
        parser.error('The test channel must be a unique ota-test-* name.')
    if args.channel == args.source_channel:
        parser.error('The test channel must differ from the target channel.')

    with Path(args.source).open('rb') as source:
        config = plistlib.load(source)
    headers = config.get('EXUpdatesRequestHeaders')
    if (
        config.get('EXUpdatesEnabled') is not True
        or config.get('EXUpdatesRuntimeVersion') != args.runtime
        or config.get('EXUpdatesURL') != args.updates_url
        or not isinstance(headers, dict)
        or headers.get('expo-channel-name') != args.source_channel
    ):
        parser.error('Target plist does not match the verified update configuration.')

    config['EXUpdatesRequestHeaders'] = {**headers, 'expo-channel-name': args.channel}
    contents = plistlib.dumps(config, fmt=plistlib.FMT_XML, sort_keys=False)
    with Path(args.output).open('xb') as output:
        output.write(contents)
    print('Created isolated test-channel Expo plist.')


if __name__ == '__main__':
    main()
