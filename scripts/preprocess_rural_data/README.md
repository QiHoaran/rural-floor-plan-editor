# Rural data preprocessing workspace

This UV workspace contains two business packages:

- `rural-data-prep`: cleans the surveyed JSON corpus and builds Graph, Image, and CAD datasets.
- `rural-embodied-plan`: builds deterministic Embodied navigation and token datasets from cleaned canonical records.

## Environment

Run all commands from this directory. The workspace uses one root `.venv` and one root `uv.lock` for both packages.

```powershell
uv sync --all-packages --all-groups
uv workspace list
```

Do not run either project with an isolated environment inside `rural-embodied-plan`.

## Main commands

```powershell
uv run rural-data-prep clean --input ..\..\data\rural_data\JSON --output ..\..\data\rural_data\cleaned --replace

uv run python 01_Json_to_Graph --force
uv run python 02_Json_to_Image --force
uv run python 03_Json_to_CAD --force
uv run python 04_Json_to_embodied --force
```

The fourth entrypoint is equivalent to:

```powershell
uv run --package rural-embodied-plan rural-embodied-plan build-corpus `
  --input-root ..\..\data\rural_data\cleaned `
  --output-root ..\..\data\rural_data\model_ready\embodied `
  --replace
```

## Verification

```powershell
uv run --package rural-data-prep python -m unittest discover -s tests -v
uv run --package rural-embodied-plan pytest rural-embodied-plan/tests
uv run --package rural-embodied-plan ruff check rural-embodied-plan/src rural-embodied-plan/tests
uv run --package rural-embodied-plan mypy `
  --config-file rural-embodied-plan/pyproject.toml `
  rural-embodied-plan/src
```

See `rural-embodied-plan/README.md` for the Embodied data model, CLI details, and visualization workflow.
