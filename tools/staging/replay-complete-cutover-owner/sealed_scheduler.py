"""Bind existing verified modules without importing another path or broadening a closure."""

import hashlib
from pathlib import Path
import sys


ROOT = Path('/root/baci-financial-owner.2ynkl9kc/bundle-r8/tooling')
PINS = {
    str(ROOT / 'runtime_scheduler.py'): 'a30f2422b100bbf61fd356bc61819a78fedc4c5163cb7fd1a73f52037e864adc',
    str(ROOT / 'treasury_owner_contract.py'): 'ddc7796625f9b421d7c01266e1914607d69e849b3f2da874426492e467a94642',
}


def bind_sealed_scheduler(context, path, source_pins, *, modules=sys.modules):
    try:
        if Path(path) != ROOT / 'runtime_scheduler.py' or source_pins != PINS:
            raise ValueError()
        bound = {}
        for filename, pin in PINS.items():
            name = Path(filename).stem
            module = modules.get(name)
            if module is None or getattr(module, '__file__', None) != filename:
                raise ValueError()
            raw = context.owner.read(Path(filename), pin, modes=(0o600,))
            if type(raw) is not bytes or hashlib.sha256(raw).hexdigest() != pin:
                raise ValueError()
            bound[name] = module
        for filename, pin in PINS.items():
            raw = context.owner.read(Path(filename), pin, modes=(0o600,))
            name = Path(filename).stem
            if type(raw) is not bytes or hashlib.sha256(raw).hexdigest() != pin \
                or modules.get(name) is not bound[name] or bound[name].__file__ != filename:
                raise ValueError()
        for filename in PINS:
            name = Path(filename).stem
            if modules.get(name) is not bound[name] or bound[name].__file__ != filename:
                raise ValueError()
        return bound['runtime_scheduler']
    except Exception:
        raise ValueError('sealed_scheduler_refused') from None
