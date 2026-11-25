#!/usr/bin/env python3
"""Builds scripts/mac/instalar-flash.sh, a self-contained installer (the repo is private, so the
installer carries its own copy of the code). Re-run after changing api/_warehouses.js or
scripts/check-flash.mjs:  python3 scripts/mac/build-installer.py"""
from pathlib import Path
root = Path(__file__).resolve().parents[2]
warehouses = (root / 'api/_warehouses.js').read_text()
check = (root / 'scripts/check-flash.mjs').read_text().replace("'../api/_warehouses.js'", "'./warehouses.mjs'")
template = (root / 'scripts/mac/instalar-flash.template.sh').read_text()
for name, body in (('WAREHOUSES', warehouses), ('CHECKFLASH', check)):
    assert f'__{name}_EOF__' not in body
    template = template.replace(f'@@{name}@@', body.rstrip('\n'))
out = root / 'scripts/mac/instalar-flash.sh'
out.write_text(template)
out.chmod(0o755)
print('ok', out)
