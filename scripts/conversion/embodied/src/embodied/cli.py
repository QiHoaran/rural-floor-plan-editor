"""Command-line interface for the deterministic embodied conversion pipeline."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Any

import typer

app = typer.Typer(no_args_is_help=True, help="Deterministic embodied floorplan conversion.")


def _print_json(value: Any) -> None:
    typer.echo(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))


@app.command("build-corpus")
def build_corpus_command(
    input_root: Annotated[Path, typer.Option("--input-root", exists=True, file_okay=False)],
    output_root: Annotated[Path, typer.Option("--output-root", file_okay=False)],
) -> None:
    """Generate all records, quarantine data failures and audit before publication."""
    from embodied.corpus import build_corpus

    _print_json(build_corpus(input_root, output_root, progress=typer.echo))


@app.command("audit-corpus")
def audit_corpus_command(
    input_root: Annotated[Path, typer.Option("--input-root", exists=True, file_okay=False)],
    output_root: Annotated[Path, typer.Option("--output-root", exists=True, file_okay=False)],
) -> None:
    """Read-back audit without changing the published corpus."""
    from embodied.corpus import audit_corpus

    _print_json(audit_corpus(output_root, input_root, progress=typer.echo))


@app.command("pipeline")
def pipeline(
    building_json: Annotated[Path, typer.Argument(exists=True, dir_okay=False)],
    output_dir: Annotated[Path, typer.Option("--output-dir", file_okay=False)],
    robot_config: Annotated[
        Path | None, typer.Option("--robot-config", exists=True, dir_okay=False)
    ] = None,
) -> None:
    """Generate one exact reversible building; never overwrite existing output."""
    from embodied.config import Config
    from embodied.pipeline import build_artifacts

    config = (
        Config()
        if robot_config is None
        else Config.model_validate_json(robot_config.read_text(encoding="utf-8"))
    )
    report = build_artifacts(
        json.loads(building_json.read_text(encoding="utf-8")), output_dir, config
    )
    _print_json(report)
    if report["status"] != "valid":
        raise typer.Exit(2)


@app.command("decode")
def decode(
    behavior_tokens: Annotated[Path, typer.Argument(exists=True, dir_okay=False)],
    robot_config: Annotated[Path, typer.Option("--robot-config", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output", dir_okay=False)],
) -> None:
    """Reconstruct solely from a token artifact and its complete robot config."""
    from embodied.behavior_token_decoder import decode_behavior_tokens
    from embodied.config import Config
    from embodied.json_writer import write_json
    from embodied.roundtrip_validator import validate_roundtrip
    from embodied.vocabulary import vocabulary

    if output.exists():
        raise FileExistsError(f"Refusing to overwrite {output}")
    config = Config.model_validate_json(robot_config.read_text(encoding="utf-8"))
    artifact = json.loads(behavior_tokens.read_text(encoding="utf-8"))
    if artifact.get("robot_config_sha256") != config.digest():
        raise ValueError("CONFIG_MISMATCH")
    if (
        artifact.get("vocabulary_version") != config.vocabulary_version
        or artifact.get("schema_version") != "behavior-tokens/2"
        or artifact.get("policy_version") != config.policy_version
    ):
        raise ValueError("TOKEN_GRAMMAR_ERROR: artifact version mismatch")
    tokens = artifact["tokens"]
    lookup = {t: i for i, t in enumerate(vocabulary(config))}
    if not isinstance(tokens, list) or any(
        not isinstance(t, str) or t not in lookup for t in tokens
    ):
        raise ValueError("TOKEN_GRAMMAR_ERROR: invalid vocabulary")
    if artifact.get("token_ids") != [lookup[t] for t in tokens]:
        raise ValueError("TOKEN_GRAMMAR_ERROR: token IDs mismatch")
    floorplan = decode_behavior_tokens(tokens, config)
    validate_roundtrip(floorplan, tokens, config)
    write_json(output, floorplan)
    typer.echo(str(output))


if __name__ == "__main__":
    app()
