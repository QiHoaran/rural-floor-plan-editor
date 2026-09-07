"""Raw building input models."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class RawVertex(BaseModel):
    """Raw vertex stored by the editor."""

    x_mm: int
    y_mm: int


class RawWall(BaseModel):
    """Raw wall referencing endpoint vertices."""

    start_vertex_id: str
    end_vertex_id: str
    wall_type: Literal["exterior", "interior", "partition"]
    thickness_mm: int = Field(gt=0)
    height_mm: int = Field(gt=0)
    material_type: str


class RawWallElement(BaseModel):
    """Door, window, or passage attached to one wall."""

    element_type: Literal["exterior_door", "exterior_window", "interior_door", "passage"]
    host_wall_id: str
    offset_from_start_mm: int = Field(ge=0)
    width_mm: int = Field(gt=0)
    height_mm: int = Field(gt=0)
    sill_height_mm: int = Field(ge=0)
    status: Literal["valid", "needs_review"]


class RawFace(BaseModel):
    """Room face with a topology boundary and semantic properties."""

    boundary_vertex_ids: list[str] = Field(min_length=3)
    area_mm2: int = Field(ge=0)
    function_code: str | None = None
    display_name: str = ""
    local_name: str = ""
    floor_finish: str | None = None
    occupied: bool | None = None
    heated: bool | None = None


class RawRelationTarget(BaseModel):
    """Relation target, either outside or another face."""

    kind: Literal["outside", "face"]
    face_id: str | None = None

    @model_validator(mode="after")
    def validate_face_id(self) -> RawRelationTarget:
        """Require a face identifier only for face targets."""

        if self.kind == "face" and not self.face_id:
            raise ValueError("face target requires face_id")
        return self


class RawRelation(BaseModel):
    """Editor-derived opening connectivity relation."""

    relation_type: Literal["opening", "connection"]
    wall_element_id: str
    from_face_id: str
    to: RawRelationTarget
    channels: dict[str, bool]


class BuildingDocument(BaseModel):
    """Validated subset of BuildingDocument v2.1 used by this project."""

    model_config = {"extra": "allow"}

    schema_version: str
    building_id: str
    coordinate_system: dict[str, Any]
    vertices: dict[str, RawVertex]
    walls: dict[str, RawWall]
    wall_elements: dict[str, RawWallElement]
    faces: dict[str, RawFace]
    relations: list[RawRelation]
    outside_regions: dict[str, dict[str, Any]] = Field(default_factory=dict)
