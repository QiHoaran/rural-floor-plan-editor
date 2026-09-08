# Rural data conversion workspace

This uv workspace converts surveyed rural building floor plans into five model-ready formats. It contains six packages:

- `conversion-shared` (`shared/`): deterministic cleaner plus the shared conversion framework (vocabulary, schemas, corpus loading, publication).
- `conversion-graph` (`graph/`): builds Graph datasets from cleaned canonical records.
- `conversion-image` (`image/`): builds Image (semantic + room-instance masks) datasets.
- `conversion-cad` (`cad/`): builds CAD (millimetre primitives + DXF) datasets.
- `embodied` (`embodied/`): builds deterministic Embodied navigation and token datasets.
- `conversion-housegan` (`housegan/`): House-GAN++ geometry and a fixed rural vocabulary, including sunroom 18.

## Environment

Run all commands from this directory. The workspace uses one root `.venv` and one root `uv.lock` for all packages.

```powershell
uv sync --all-packages --all-groups
uv workspace list
```

Do not create an isolated environment inside any member package.

## Main commands

```powershell
uv run conversion-clean clean --input ..\..\data\rural_data\JSON --output ..\..\data\rural_data\cleaned --replace

uv run conversion-graph --force
uv run conversion-image --force
uv run conversion-cad --force
uv run conversion-housegan --input D:\data\house\building.json --output D:\output\house\HouseGAN
uv run embodied build-corpus --input-root ..\..\data\rural_data\cleaned --output-root ..\..\data\rural_data\model_ready\embodied
```

The server-facing worker is `adapter.py`, invoked with the workspace interpreter:

```powershell
.venv/Scripts/python.exe adapter.py --check
.venv/Scripts/python.exe adapter.py --request <absolute path to request.json>
```

## Verification

```powershell
uv run python -m unittest discover -s tests -v
uv run pytest embodied/tests
uv run ruff check embodied/src embodied/tests
uv run mypy --config-file embodied/pyproject.toml embodied/src
```

See `embodied/README.md` for the Embodied data model and CLI details.
See `housegan/README.md` for HouseGAN artifacts, class IDs and upstream model usage.
