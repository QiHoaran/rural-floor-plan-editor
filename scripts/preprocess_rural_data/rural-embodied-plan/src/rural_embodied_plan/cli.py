"""Command-line interface for the complete deterministic pipeline."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Any

import typer

from rural_embodied_plan.analysis.building_statistics import inspect_building
from rural_embodied_plan.config import (
    default_config_path,
    default_robot_config_path,
    load_config,
    load_robot_config,
)
from rural_embodied_plan.corpus import CorpusBuildError, build_corpus
from rural_embodied_plan.domain.navigation import NavigationScene
from rural_embodied_plan.domain.tokens import TokenSequence
from rural_embodied_plan.domain.trajectory import Trajectory
from rural_embodied_plan.encoding.trajectory_encoder import encode_trajectory
from rural_embodied_plan.io.building_loader import load_building
from rural_embodied_plan.io.json_writer import read_json, write_json
from rural_embodied_plan.pipeline import build_pipeline_artifacts, build_timed_pipeline_artifacts
from rural_embodied_plan.reconstruction.graph_builder import reconstruct_spatial_graph
from rural_embodied_plan.scene.scene_builder import build_scene
from rural_embodied_plan.timed_corpus import TimedCorpusBuildError, build_timed_corpus
from rural_embodied_plan.traversal.explorer import generate_trajectory
from rural_embodied_plan.visualization.server import serve_visualization
from rural_embodied_plan.visualization.session import PlaybackSessionError

app = typer.Typer(no_args_is_help=True, help="Deterministic rural-building exploration pipeline.")
DEFAULT_CONFIG_PATH = default_config_path()
DEFAULT_ROBOT_CONFIG_PATH = default_robot_config_path()
ConfigOption = Annotated[
    Path,
    typer.Option("--config", exists=True, dir_okay=False, help="YAML discretization config."),
]


def _print_json(value: Any) -> None:
    typer.echo(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))


@app.command("build-v2-corpus")
def build_v2_corpus_command(
    input_root: Annotated[Path, typer.Option("--input-root", exists=True, file_okay=False)],
    output_root: Annotated[Path, typer.Option("--output-root", file_okay=False)],
) -> None:
    """Generate all v2 records, quarantine data failures and audit before publication."""
    from rural_embodied_plan.v2.corpus import build_v2_corpus

    _print_json(build_v2_corpus(input_root, output_root, progress=typer.echo))


@app.command("audit-v2-corpus")
def audit_v2_corpus_command(
    input_root: Annotated[Path, typer.Option("--input-root", exists=True, file_okay=False)],
    output_root: Annotated[Path, typer.Option("--output-root", exists=True, file_okay=False)],
) -> None:
    """Read-back audit without changing the published corpus."""
    from rural_embodied_plan.v2.corpus import audit_v2_corpus

    _print_json(audit_v2_corpus(output_root, input_root, progress=typer.echo))


@app.command("pipeline-v2")
def pipeline_v2(
    building_json: Annotated[Path, typer.Argument(exists=True, dir_okay=False)],
    output_dir: Annotated[Path, typer.Option("--output-dir", file_okay=False)],
    robot_config: Annotated[
        Path | None, typer.Option("--robot-config", exists=True, dir_okay=False)
    ] = None,
) -> None:
    """Generate one exact reversible v2 building; never overwrite existing output."""
    from rural_embodied_plan.v2.config import V2Config
    from rural_embodied_plan.v2.pipeline import build_v2_artifacts

    config = (
        V2Config()
        if robot_config is None
        else V2Config.model_validate_json(robot_config.read_text(encoding="utf-8"))
    )
    report = build_v2_artifacts(
        json.loads(building_json.read_text(encoding="utf-8")), output_dir, config
    )
    _print_json(report)
    if report["status"] != "valid":
        raise typer.Exit(2)


@app.command("decode-v2")
def decode_v2(
    behavior_tokens: Annotated[Path, typer.Argument(exists=True, dir_okay=False)],
    robot_config: Annotated[Path, typer.Option("--robot-config", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output", dir_okay=False)],
) -> None:
    """Reconstruct solely from a v2 token artifact and its complete robot config."""
    from rural_embodied_plan.v2.behavior_token_decoder import decode_behavior_tokens
    from rural_embodied_plan.v2.config import V2Config
    from rural_embodied_plan.v2.roundtrip_validator import validate_roundtrip
    from rural_embodied_plan.v2.vocabulary import vocabulary

    if output.exists():
        raise FileExistsError(f"Refusing to overwrite {output}")
    config = V2Config.model_validate_json(robot_config.read_text(encoding="utf-8"))
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


@app.command()
def inspect(
    building_json: Annotated[Path, typer.Argument(exists=True, dir_okay=False)],
) -> None:
    """Inspect verified source fields and collection sizes."""

    _print_json(inspect_building(load_building(building_json)))


@app.command("build-scene")
def build_scene_command(
    building_json: Annotated[Path, typer.Argument(exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output", dir_okay=False)],
    config: ConfigOption = DEFAULT_CONFIG_PATH,
) -> None:
    """Build navigation_scene.json from a source BuildingDocument."""

    scene = build_scene(load_building(building_json), load_config(config))
    write_json(output, scene)
    typer.echo(str(output))


@app.command("generate-trajectory")
def generate_trajectory_command(
    navigation_scene: Annotated[Path, typer.Argument(exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output", dir_okay=False)],
) -> None:
    """Generate a deterministic room-level DFS trajectory."""

    scene = NavigationScene.model_validate(read_json(navigation_scene))
    write_json(output, generate_trajectory(scene))
    typer.echo(str(output))


@app.command()
def encode(
    trajectory_json: Annotated[Path, typer.Argument(exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output", dir_okay=False)],
    config: ConfigOption = DEFAULT_CONFIG_PATH,
) -> None:
    """Encode a trajectory as readable Action-Observation tokens."""

    trajectory = Trajectory.model_validate(read_json(trajectory_json))
    tokens = encode_trajectory(trajectory, load_config(config), trajectory_json.name)
    write_json(output, tokens)
    typer.echo(str(output))


@app.command()
def reconstruct(
    tokens_json: Annotated[Path, typer.Argument(exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output", dir_okay=False)],
) -> None:
    """Reconstruct a spatial graph solely from tokens."""

    tokens = TokenSequence.model_validate(read_json(tokens_json))
    write_json(output, reconstruct_spatial_graph(tokens))
    typer.echo(str(output))


@app.command()
def pipeline(
    building_json: Annotated[Path, typer.Argument(exists=True, dir_okay=False)],
    output_dir: Annotated[Path, typer.Option("--output-dir", file_okay=False)],
    config: ConfigOption = DEFAULT_CONFIG_PATH,
) -> None:
    """Run the complete scene, traversal, token, reconstruction, and validation pipeline."""

    settings = load_config(config)
    document = load_building(building_json)
    report = build_pipeline_artifacts(document, output_dir, settings)
    _print_json(report)


@app.command("pipeline-timed")
def pipeline_timed(
    building_json: Annotated[Path, typer.Argument(exists=True, dir_okay=False)],
    output_dir: Annotated[Path, typer.Option("--output-dir", file_okay=False)],
    config: ConfigOption = DEFAULT_CONFIG_PATH,
    robot_config: Annotated[
        Path,
        typer.Option(
            "--robot-config",
            exists=True,
            dir_okay=False,
            help="Versioned robot dynamics and canonical policy JSON.",
        ),
    ] = DEFAULT_ROBOT_CONFIG_PATH,
) -> None:
    """Generate and validate canonical_dfs_time_v1 artifacts for one building."""

    document = load_building(building_json)
    report = build_timed_pipeline_artifacts(
        document,
        output_dir,
        load_config(config),
        load_robot_config(robot_config),
    )
    _print_json(report)


@app.command("build-corpus")
def build_corpus_command(
    input_root: Annotated[
        Path,
        typer.Option("--input-root", exists=True, file_okay=False, help="Cleaned corpus root."),
    ],
    output_root: Annotated[
        Path,
        typer.Option("--output-root", file_okay=False, help="Embodied corpus output root."),
    ],
    config: ConfigOption = DEFAULT_CONFIG_PATH,
    replace: Annotated[
        bool,
        typer.Option("--replace", help="Atomically replace an existing complete corpus."),
    ] = False,
) -> None:
    """Build a complete Embodied corpus from verified cleaned canonical records."""

    try:
        _print_json(
            build_corpus(
                input_root,
                output_root,
                config_path=config,
                replace=replace,
            )
        )
    except CorpusBuildError as error:
        raise typer.BadParameter(str(error), param_hint="--input-root") from error


@app.command("build-timed-corpus")
def build_timed_corpus_command(
    input_root: Annotated[
        Path,
        typer.Option("--input-root", exists=True, file_okay=False, help="Cleaned corpus root."),
    ],
    output_root: Annotated[
        Path,
        typer.Option("--output-root", file_okay=False, help="Timed corpus output root."),
    ],
    config: ConfigOption = DEFAULT_CONFIG_PATH,
    robot_config: Annotated[
        Path,
        typer.Option(
            "--robot-config",
            exists=True,
            dir_okay=False,
            help="Versioned robot dynamics and canonical policy JSON.",
        ),
    ] = DEFAULT_ROBOT_CONFIG_PATH,
    replace: Annotated[
        bool,
        typer.Option("--replace", help="Atomically replace an existing timed corpus."),
    ] = False,
) -> None:
    """Generate and audit a quarantine-aware canonical timed corpus."""

    try:
        _print_json(
            build_timed_corpus(
                input_root,
                output_root,
                config_path=config,
                robot_config_path=robot_config,
                replace=replace,
            )
        )
    except TimedCorpusBuildError as error:
        raise typer.BadParameter(str(error), param_hint="--input-root") from error


@app.command()
def visualize(
    output_dir: Annotated[
        Path,
        typer.Argument(exists=True, file_okay=False, help="Pipeline output directory."),
    ],
    host: Annotated[str, typer.Option("--host", help="HTTP bind address.")] = "127.0.0.1",
    port: Annotated[
        int,
        typer.Option("--port", min=1, max=65535, help="HTTP listen port."),
    ] = 8765,
    no_open: Annotated[
        bool,
        typer.Option("--no-open", help="Do not open the default browser."),
    ] = False,
) -> None:
    """Play robot exploration and action-observation tokens in a local browser."""

    try:
        serve_visualization(output_dir, host, port, not no_open)
    except (PlaybackSessionError, OSError) as error:
        raise typer.BadParameter(str(error), param_hint="OUTPUT_DIR") from error


if __name__ == "__main__":
    app()
