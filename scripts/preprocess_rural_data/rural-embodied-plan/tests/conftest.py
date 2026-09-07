"""Shared fixtures for integration and geometry tests."""

from pathlib import Path

import pytest
from editor_samples import sample_path

from rural_embodied_plan.config import ProjectConfig, load_config
from rural_embodied_plan.domain.building import BuildingDocument
from rural_embodied_plan.domain.navigation import NavigationScene
from rural_embodied_plan.domain.trajectory import Trajectory
from rural_embodied_plan.io.building_loader import load_building
from rural_embodied_plan.scene.scene_builder import build_scene
from rural_embodied_plan.traversal.explorer import generate_trajectory



@pytest.fixture
def config() -> ProjectConfig:
    """Load the repository sample configuration."""

    return load_config(Path(__file__).resolve().parents[1] / "examples/sample_config.yaml")


@pytest.fixture
def building() -> BuildingDocument:
    """Load the read-only editor sample."""

    return load_building(sample_path("rural_001_house_0015"))


@pytest.fixture
def scene(building: BuildingDocument, config: ProjectConfig) -> NavigationScene:
    """Build the canonical sample navigation scene."""

    return build_scene(building, config)


@pytest.fixture
def trajectory(scene: NavigationScene) -> Trajectory:
    """Generate the canonical sample traversal."""

    return generate_trajectory(scene)
