import json
from pathlib import Path
import runpy
import sys
import traceback


def failure_report(error):
    return {'status': 'readonly-public-preflight-refused', 'readOnly': True,
        'errorType': type(error).__name__, 'redacted': True,
        'frames': [{'module': Path(frame.filename).name, 'line': frame.lineno}
                   for frame in traceback.extract_tb(error.__traceback__)],
        'newPaymentStarted': False, 'databaseApplied': False}


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError()
        bundle = Path(sys.argv[1])
        sys.path.insert(0, str(bundle))
        context = runpy.run_path(str(bundle / 'owner-check.py'), run_name='diagnostic_target')
        context['preflight'](bundle)
        print(json.dumps({'status': 'readonly-public-preflight-ready', 'readOnly': True}))
    except Exception as error:
        print(json.dumps(failure_report(error)))
        raise SystemExit(1)
