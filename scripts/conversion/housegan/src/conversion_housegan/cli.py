"""Standalone conversion of one completed building.json, with atomic publication."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path

from conversion_shared.discovery import BuildingSource
from conversion_shared.records import build_records

from .housegan import write_artifacts, write_json


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    try:
        source, output = args.input.resolve(), args.output.absolute()
        if output.exists() or output.is_symlink():
            raise ValueError(f'Refusing to overwrite {output}')
        raw = source.read_bytes()
        document = json.loads(raw)
        if document.get('workflow', {}).get('status') != 'complete':
            raise ValueError('SOURCE_NOT_COMPLETE')
        digest = hashlib.sha256(raw).hexdigest()
        cleaned = build_records(BuildingSource(document['building_id'], source, f"{document['building_id']}/building.json", digest, document))
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.housegan-', dir=output.parent) as temporary:
            stage = Path(temporary)/'HouseGAN'
            config = write_artifacts(cleaned.canonical, stage)
            write_json(stage/'conversion.json', {
                'schema_version': 'building-conversion/1.0.0', 'building_id': document['building_id'],
                'source_revision': document.get('metadata', {}).get('revision'), 'source_sha256': digest,
                'format': 'housegan', 'converter_version': '1.0.0', 'config': config,
                'repairs': cleaned.canonical['repairs'],
                'artifacts': [{'path': p.name, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(stage.iterdir())],
            })
            if output.exists() or output.is_symlink():
                raise ValueError(f'Refusing to overwrite {output}')
            stage.rename(output)
        print(f'HouseGAN: {output}')
        return 0
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f'{type(error).__name__}: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
