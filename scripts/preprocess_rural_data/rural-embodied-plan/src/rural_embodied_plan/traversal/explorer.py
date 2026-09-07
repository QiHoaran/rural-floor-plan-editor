"""Deterministic multi-entrance DFS building explorer."""

from __future__ import annotations

from dataclasses import dataclass, field

from rural_embodied_plan.config import RobotConfig, robot_config_sha256
from rural_embodied_plan.domain.geometry import Direction, Point2D, RelativeDirection
from rural_embodied_plan.domain.navigation import NavigationScene, Opening, OpeningType, Room
from rural_embodied_plan.domain.robot import (
    NavigationReason,
    Observation,
    ObservationType,
    RobotAction,
    RobotActionType,
    RobotState,
    TimedRobotAction,
    TimedRobotState,
    TraversalPhase,
)
from rural_embodied_plan.domain.trajectory import (
    LocalEntityMap,
    RoomActivation,
    TimedTrajectory,
    Trajectory,
)
from rural_embodied_plan.geometry.directions import (
    direction_between,
    opposite,
    relative_direction,
    vector,
)
from rural_embodied_plan.geometry.orthogonal_path import orthogonal_path, plan_rectilinear_path
from rural_embodied_plan.timing import movement_duration_ms, turn_duration_ms
from rural_embodied_plan.traversal.door_ordering import ordered_interior_doors
from rural_embodied_plan.traversal.entrance_selector import ordered_exterior_doors
from rural_embodied_plan.traversal.state_machine import StateMachine, TimedStateMachine
from rural_embodied_plan.traversal.wall_observer import observe_room


@dataclass
class _Context:
    scene: NavigationScene
    machine: StateMachine
    rooms: dict[str, Room]
    openings: dict[str, Opening]
    dynamic_ids: dict[str, str] = field(default_factory=dict)
    activations: list[RoomActivation] = field(default_factory=list)
    processed: set[str] = field(default_factory=set)
    observed: set[str] = field(default_factory=set)
    loop_count: int = 0
    warnings: list[str] = field(default_factory=list)

    def state_lists(self) -> dict[str, list[str]]:
        return {
            "visited_room_ids": list(self.dynamic_ids),
            "visited_door_ids": sorted(self.observed),
            "processed_opening_ids": sorted(self.processed),
        }


def _turn_action(relative: RelativeDirection) -> RobotActionType | None:
    return {
        RelativeDirection.FRONT: None,
        RelativeDirection.LEFT: RobotActionType.TURN_LEFT,
        RelativeDirection.RIGHT: RobotActionType.TURN_RIGHT,
        RelativeDirection.BACK: RobotActionType.TURN_BACK,
    }[relative]


def _move_path(context: _Context, points: list[Point2D], backtracking: bool = False) -> None:
    """Emit compressed turns and forward moves for an orthogonal point path."""

    for start, end in zip(points, points[1:], strict=False):
        direction = direction_between(start, end)
        relative = relative_direction(context.machine.state.heading, direction)
        turn_type = _turn_action(relative)
        phase = TraversalPhase.BACKTRACKING if backtracking else TraversalPhase.NAVIGATING
        if turn_type is not None:
            context.machine.emit(
                action=RobotAction(type=turn_type),
                updates={"heading": direction},
                phase=phase,
            )
        distance = abs(end.x_mm - start.x_mm) + abs(end.y_mm - start.y_mm)
        context.machine.emit(
            action=RobotAction(type=RobotActionType.MOVE_FORWARD, distance_mm=distance),
            updates={"position": end},
            phase=phase,
        )


def _move_to(
    context: _Context, room: Room, goal: Point2D, backtracking: bool = False
) -> list[Point2D]:
    path = orthogonal_path(
        context.machine.state.position, goal, room.polygon, context.machine.state.heading
    )
    _move_path(context, path, backtracking)
    return path


def _observe(context: _Context, room: Room, entry_door_id: str) -> None:
    observations = observe_room(context.scene, room, context.machine.state.heading, entry_door_id)
    action_types = [
        None,
        RobotActionType.LOOK_FRONT,
        RobotActionType.LOOK_LEFT,
        RobotActionType.LOOK_RIGHT,
    ]
    for observation, action_type in zip(observations, action_types, strict=True):
        for wall in observation.wall_segments:
            context.observed.update(component.id for component in wall.openings)
        context.machine.emit(
            action=RobotAction(type=action_type) if action_type is not None else None,
            observation=observation,
            updates=context.state_lists(),
            phase=TraversalPhase.OBSERVING,
        )


def _enter_room(
    context: _Context,
    room_id: str,
    door: Opening,
    depth: int,
    stack: list[str],
) -> None:
    room = context.rooms[room_id]
    is_new = room_id not in context.dynamic_ids
    if is_new:
        dynamic_id = f"ROOM_{len(context.dynamic_ids)}"
        context.dynamic_ids[room_id] = dynamic_id
        context.activations.append(
            RoomActivation(
                dynamic_id=dynamic_id,
                source_room_id=room_id,
                function=room.function,
                area_mm2=room.area_mm2,
                east_west_size_mm=room.east_west_size_mm,
                north_south_size_mm=room.north_south_size_mm,
                entry_door_id=door.id,
                entry_direction=context.machine.state.heading,
                depth=depth,
            )
        )
    dynamic_id = context.dynamic_ids[room_id]
    observation = Observation(
        type=ObservationType.ENTER_NEW_ROOM if is_new else ObservationType.ENTER_VISITED_ROOM,
        data={
            "dynamic_room_id": dynamic_id if is_new else dynamic_id.replace("ROOM_", "ROOM_REF_"),
            "source_room_id": room_id,
            "function": room.function,
            "area_mm2": room.area_mm2,
            "bounds": room.bounds.model_dump(mode="json"),
            "east_west_size_mm": room.east_west_size_mm,
            "north_south_size_mm": room.north_south_size_mm,
            "entry_door_id": door.id,
            "entry_direction": context.machine.state.heading.value,
            "depth": depth,
        },
    )
    context.machine.emit(
        observation=observation,
        updates={
            **context.state_lists(),
            "current_room_id": room_id,
            "entry_door_id": door.id,
            "current_door_id": door.id,
            "room_stack": stack,
        },
        phase=TraversalPhase.ENTERING,
    )
    if not is_new:
        return
    _observe(context, room, door.id)
    for door_id in ordered_interior_doors(context.scene, room, door.id):
        if door_id in context.processed:
            continue
        candidate = context.openings[door_id]
        context.processed.add(door_id)
        target_id = next(value for value in candidate.room_ids if value != room_id)
        start_position = context.machine.state.position
        context.machine.emit(
            action=RobotAction(
                type=RobotActionType.SELECT_INTERIOR_DOOR,
                door_id=door_id,
                target_room_id=target_id,
            ),
            updates={**context.state_lists(), "current_door_id": door_id},
        )
        outward = candidate.global_directions[room_id]
        forward_path = _move_to(context, room, candidate.room_anchors[room_id])
        crossing_relative = relative_direction(context.machine.state.heading, outward)
        crossing_turn = _turn_action(crossing_relative)
        if crossing_turn is not None:
            context.machine.emit(
                action=RobotAction(type=crossing_turn), updates={"heading": outward}
            )
        context.machine.emit(
            action=RobotAction(
                type=RobotActionType.CROSS_DOOR, door_id=door_id, target_room_id=target_id
            ),
            updates={
                "position": candidate.room_anchors[target_id],
                "current_room_id": target_id,
                "current_door_id": door_id,
            },
        )
        if target_id in context.dynamic_ids:
            _enter_room(context, target_id, candidate, depth, [*stack, room_id])
            context.loop_count += 1
            context.machine.emit(
                observation=Observation(
                    type=ObservationType.LOOP_CLOSURE,
                    data={
                        "door_id": door_id,
                        "from_room": context.dynamic_ids[room_id],
                        "to_room": context.dynamic_ids[target_id],
                    },
                )
            )
            context.machine.emit(
                action=RobotAction(
                    type=RobotActionType.CROSS_DOOR, door_id=door_id, target_room_id=room_id
                ),
                updates={
                    "position": candidate.room_anchors[room_id],
                    "heading": opposite(outward),
                    "current_room_id": room_id,
                },
            )
        else:
            _enter_room(context, target_id, candidate, depth + 1, [*stack, room_id])
            child = context.rooms[target_id]
            _move_to(context, child, candidate.room_anchors[target_id], True)
            back_direction = candidate.global_directions[target_id]
            turn_type = _turn_action(
                relative_direction(context.machine.state.heading, back_direction)
            )
            context.machine.emit(
                action=RobotAction(type=RobotActionType.BACKTRACK),
                phase=TraversalPhase.BACKTRACKING,
            )
            if turn_type is not None:
                context.machine.emit(
                    action=RobotAction(type=turn_type),
                    updates={"heading": back_direction},
                    phase=TraversalPhase.BACKTRACKING,
                )
            context.machine.emit(
                action=RobotAction(
                    type=RobotActionType.CROSS_DOOR, door_id=door_id, target_room_id=room_id
                ),
                updates={
                    "position": candidate.room_anchors[room_id],
                    "current_room_id": room_id,
                    "current_door_id": door_id,
                    "entry_door_id": door.id,
                    "room_stack": stack,
                },
                phase=TraversalPhase.BACKTRACKING,
            )
        reverse_path = list(reversed(forward_path))
        if reverse_path and reverse_path[0] != context.machine.state.position:
            reverse_path[0] = context.machine.state.position
        _move_path(context, reverse_path, True)
        if context.machine.state.position != start_position:
            raise ValueError(f"Backtracking through {door_id} did not restore the parent position")


def _explore_component(context: _Context, exterior: Opening, primary: bool) -> None:
    room_id = exterior.room_ids[0]
    if room_id in context.dynamic_ids:
        return
    assert exterior.outside_anchor is not None
    inward = opposite(exterior.global_directions[room_id])
    context.machine.emit(
        action=RobotAction(type=RobotActionType.SELECT_EXTERIOR_DOOR, door_id=exterior.id),
        observation=Observation(
            type=ObservationType.AT_DOOR,
            data={"door_id": exterior.id, "primary": primary},
        ),
        updates={
            "position": exterior.outside_anchor,
            "heading": inward,
            "current_door_id": exterior.id,
            "current_room_id": None,
        },
        phase=TraversalPhase.OUTSIDE,
    )
    context.observed.add(exterior.id)
    context.machine.emit(
        action=RobotAction(
            type=RobotActionType.CROSS_DOOR, door_id=exterior.id, target_room_id=room_id
        ),
        updates={"position": exterior.room_anchors[room_id], "current_room_id": room_id},
    )
    _enter_room(context, room_id, exterior, 0, [])
    room = context.rooms[room_id]
    _move_to(context, room, exterior.room_anchors[room_id], True)
    outward = exterior.global_directions[room_id]
    turn_type = _turn_action(relative_direction(context.machine.state.heading, outward))
    if turn_type is not None:
        context.machine.emit(action=RobotAction(type=turn_type), updates={"heading": outward})
    context.machine.emit(
        action=RobotAction(type=RobotActionType.EXIT_BUILDING, door_id=exterior.id),
        updates={
            "position": exterior.outside_anchor,
            "current_room_id": None,
            "current_door_id": exterior.id,
            "entry_door_id": None,
            "room_stack": [],
        },
        phase=TraversalPhase.OUTSIDE,
    )


def _observe_visual_only_room(context: _Context, room_id: str) -> None:
    """Represent a window-only room without claiming that the robot traversed the window."""

    candidates = sorted(
        (
            opening
            for opening in context.scene.openings
            if opening.opening_type == OpeningType.WINDOW
            and opening.connects_outside
            and room_id in opening.room_ids
        ),
        key=lambda opening: opening.id,
    )
    if not candidates:
        raise ValueError(f"Traversal could not reach or visually observe room: {room_id}")
    window = candidates[0]
    assert window.outside_anchor is not None
    heading = opposite(window.global_directions[room_id])
    room = context.rooms[room_id]
    dynamic_id = f"ROOM_{len(context.dynamic_ids)}"
    context.dynamic_ids[room_id] = dynamic_id
    context.activations.append(
        RoomActivation(
            dynamic_id=dynamic_id,
            source_room_id=room_id,
            function=room.function,
            area_mm2=room.area_mm2,
            east_west_size_mm=room.east_west_size_mm,
            north_south_size_mm=room.north_south_size_mm,
            entry_door_id=window.id,
            entry_direction=heading,
            depth=0,
            access_mode="visual_only",
        )
    )
    context.observed.add(window.id)
    context.warnings.append(
        f"Room {room_id} was represented visually through exterior window {window.id}; "
        "the window was not traversed"
    )
    context.machine.emit(
        action=RobotAction(
            type=RobotActionType.SELECT_EXTERIOR_WINDOW,
            door_id=window.id,
            target_room_id=room_id,
        ),
        observation=Observation(
            type=ObservationType.EXTERIOR_WINDOW_VIEW,
            data={
                "dynamic_room_id": dynamic_id,
                "source_room_id": room_id,
                "opening_id": window.id,
                "access_mode": "visual_only",
                "function": room.function,
                "area_mm2": room.area_mm2,
            },
        ),
        updates={
            **context.state_lists(),
            "position": window.outside_anchor,
            "heading": heading,
            "current_room_id": None,
            "current_door_id": window.id,
            "entry_door_id": None,
        },
        phase=TraversalPhase.OUTSIDE,
    )


def generate_trajectory(scene: NavigationScene) -> Trajectory:
    """Explore every room deterministically using DFS and exterior component fallback."""

    exterior_doors = ordered_exterior_doors(scene)
    primary = exterior_doors[0]
    assert primary.outside_anchor is not None
    primary_room = primary.room_ids[0]
    initial = RobotState(
        position=primary.outside_anchor,
        heading=opposite(primary.global_directions[primary_room]),
        phase=TraversalPhase.OUTSIDE,
        primary_exterior_door_id=primary.id,
    )
    context = _Context(
        scene=scene,
        machine=StateMachine(initial),
        rooms={room.id: room for room in scene.rooms},
        openings={opening.id: opening for opening in scene.openings},
    )
    context.machine.emit(observation=Observation(type=ObservationType.OUTSIDE))
    _explore_component(context, primary, True)
    for secondary in exterior_doors[1:]:
        if secondary.room_ids[0] not in context.dynamic_ids:
            context.warnings.append(
                f"Used secondary exterior door {secondary.id} to cover "
                "an unvisited indoor component"
            )
            _explore_component(context, secondary, False)
    for room_id in sorted(set(context.rooms) - set(context.dynamic_ids)):
        _observe_visual_only_room(context, room_id)
    context.machine.emit(
        action=RobotAction(type=RobotActionType.SELECT_EXTERIOR_DOOR, door_id=primary.id),
        updates={
            "position": primary.outside_anchor,
            "heading": opposite(primary.global_directions[primary_room]),
            "current_door_id": primary.id,
        },
        phase=TraversalPhase.OUTSIDE,
    )
    context.machine.emit(
        action=RobotAction(type=RobotActionType.STOP),
        updates={**context.state_lists(), "current_room_id": None},
        phase=TraversalPhase.COMPLETE,
    )
    return Trajectory(
        building_id=scene.building_id,
        primary_exterior_door_id=primary.id,
        room_activations=context.activations,
        events=context.machine.events,
        visited_room_ids=list(context.dynamic_ids),
        processed_interior_door_ids=sorted(context.processed),
        loop_closure_count=context.loop_count,
        warnings=sorted(context.warnings),
    )


@dataclass
class _TimedContext:
    scene: NavigationScene
    config: RobotConfig
    machine: TimedStateMachine
    rooms: dict[str, Room]
    openings: dict[str, Opening]
    room_source_to_local: dict[str, str] = field(default_factory=dict)
    opening_source_to_local: dict[str, str] = field(default_factory=dict)
    visited_rooms: set[str] = field(default_factory=set)
    processed: set[str] = field(default_factory=set)
    processed_order: list[str] = field(default_factory=list)
    loop_count: int = 0

    def room_local(self, source_id: str) -> str:
        if source_id not in self.room_source_to_local:
            self.room_source_to_local[source_id] = f"ROOM_{len(self.room_source_to_local)}"
        return self.room_source_to_local[source_id]

    def opening_local(self, source_id: str) -> str:
        if source_id not in self.opening_source_to_local:
            opening = self.openings[source_id]
            prefix = "OPENING" if opening.opening_type == OpeningType.WINDOW else "DOOR"
            count = sum(
                value.startswith(f"{prefix}_") for value in self.opening_source_to_local.values()
            )
            self.opening_source_to_local[source_id] = f"{prefix}_{count}"
        return self.opening_source_to_local[source_id]


def _configured_anchor(opening: Opening, room_id: str | None, config: RobotConfig) -> Point2D:
    if room_id is None:
        room_id = opening.room_ids[0]
        direction = opening.global_directions[room_id]
    else:
        direction = opposite(opening.global_directions[room_id])
    dx, dy = vector(direction)
    offset = config.geometry.door_anchor_offset_mm
    return Point2D(
        x_mm=opening.center.x_mm + dx * offset,
        y_mm=opening.center.y_mm + dy * offset,
    )


def _fixed_duration(context: _TimedContext, action: RobotActionType) -> int:
    return context.config.fixed_action_duration_ms.get(action.value, 0)


def _timed_turn_to(
    context: _TimedContext,
    target: Direction,
    phase: TraversalPhase,
    reason: NavigationReason | None = None,
) -> None:
    relative = relative_direction(context.machine.state.heading, target)
    action_type = _turn_action(relative)
    if action_type is None:
        return
    angle = 180000 if relative == RelativeDirection.BACK else 90000
    context.machine.emit(
        action=TimedRobotAction(type=action_type, turn_angle_mdeg=angle),
        duration_ms=turn_duration_ms(angle, context.config.dynamics.angular_speed_mdeg_per_s),
        updates={"heading": target},
        phase=phase,
        navigation_reason=reason,
    )


def _timed_move_to(
    context: _TimedContext,
    room: Room,
    goal: Point2D,
    phase: TraversalPhase,
    reason: NavigationReason,
) -> None:
    planned = plan_rectilinear_path(
        context.machine.state.position,
        goal,
        room.polygon,
        context.machine.state.heading,
        context.config,
    )
    for start, end in zip(planned.points, planned.points[1:], strict=False):
        heading = direction_between(start, end)
        _timed_turn_to(context, heading, phase, reason)
        distance = abs(end.x_mm - start.x_mm) + abs(end.y_mm - start.y_mm)
        context.machine.emit(
            action=TimedRobotAction(type=RobotActionType.MOVE_FORWARD, distance_mm=distance),
            duration_ms=movement_duration_ms(
                distance, context.config.dynamics.linear_speed_mm_per_s
            ),
            updates={"position": end},
            phase=phase,
            navigation_reason=reason,
        )


def _localize_observation(context: _TimedContext, observation: Observation) -> Observation:
    localized_walls = []
    for wall in observation.wall_segments:
        localized_openings = []
        for opening in wall.openings:
            local_id = context.opening_local(opening.id)
            localized_openings.append(opening.model_copy(update={"id": local_id}))
        localized_walls.append(wall.model_copy(update={"openings": localized_openings}))
    return observation.model_copy(update={"wall_segments": localized_walls}, deep=True)


def _timed_observe(context: _TimedContext, room: Room, entry_door_id: str) -> None:
    observations = observe_room(context.scene, room, context.machine.state.heading, entry_door_id)
    actions = [
        None,
        RobotActionType.LOOK_FRONT,
        RobotActionType.LOOK_LEFT,
        RobotActionType.LOOK_RIGHT,
    ]
    for observation, action_type in zip(observations, actions, strict=True):
        localized = _localize_observation(context, observation)
        action = TimedRobotAction(type=action_type) if action_type is not None else None
        context.machine.emit(
            action=action,
            observation=localized,
            duration_ms=0 if action_type is None else _fixed_duration(context, action_type),
            phase=TraversalPhase.OBSERVING,
        )


def _timed_cross(
    context: _TimedContext,
    opening: Opening,
    source_room_id: str | None,
    target_room_id: str | None,
    *,
    exiting: bool = False,
    phase: TraversalPhase = TraversalPhase.CROSSING,
    reason: NavigationReason | None = None,
    dfs_depth: int | None = None,
) -> None:
    required_width = 2 * context.config.geometry.clearance_mm
    if opening.width_mm < required_width:
        raise ValueError(
            f"Opening {opening.id} is narrower than required robot clearance "
            f"({opening.width_mm} < {required_width} mm)"
        )
    source_anchor = _configured_anchor(opening, source_room_id, context.config)
    target_anchor = _configured_anchor(opening, target_room_id, context.config)
    if context.machine.state.position != source_anchor:
        raise ValueError(f"Robot is not at source anchor for door {opening.id}")
    distance = abs(target_anchor.x_mm - source_anchor.x_mm) + abs(
        target_anchor.y_mm - source_anchor.y_mm
    )
    action_type = RobotActionType.EXIT_BUILDING if exiting else RobotActionType.CROSS_DOOR
    known_target_local_id = (
        context.room_source_to_local.get(target_room_id) if target_room_id is not None else None
    )
    updates: dict[str, object] = {
        "position": target_anchor,
        "current_room_local_id": known_target_local_id,
        "current_door_local_id": context.opening_local(opening.id),
    }
    if dfs_depth is not None:
        updates["dfs_depth"] = dfs_depth
    context.machine.emit(
        action=TimedRobotAction(
            type=action_type,
            distance_mm=distance,
            door_local_id=context.opening_local(opening.id),
        ),
        duration_ms=movement_duration_ms(
            distance, context.config.dynamics.door_crossing_speed_mm_per_s
        ),
        updates=updates,
        phase=phase,
        navigation_reason=reason,
    )


def _timed_enter_observation(
    context: _TimedContext,
    room_id: str,
    entry_door_id: str,
    depth: int,
    *,
    visited: bool,
) -> None:
    room = context.rooms[room_id]
    context.machine.emit(
        observation=Observation(
            type=(
                ObservationType.ENTER_VISITED_ROOM if visited else ObservationType.ENTER_NEW_ROOM
            ),
            data={
                "room_local_id": context.room_local(room_id),
                "entry_door_local_id": context.opening_local(entry_door_id),
                "function": room.function,
                "depth": depth,
            },
        ),
        duration_ms=0,
        updates={
            "current_room_local_id": context.room_local(room_id),
            "entry_door_local_id": context.opening_local(entry_door_id),
            "dfs_depth": depth,
        },
        phase=TraversalPhase.LOOP_CLOSING if visited else TraversalPhase.CROSSING,
    )


def _timed_explore_room(
    context: _TimedContext,
    room_id: str,
    entry_door_id: str,
    parent_room_id: str | None,
    depth: int,
) -> None:
    room = context.rooms[room_id]
    context.visited_rooms.add(room_id)
    _timed_enter_observation(context, room_id, entry_door_id, depth, visited=False)
    _timed_observe(context, room, entry_door_id)
    for door_id in ordered_interior_doors(context.scene, room, entry_door_id):
        if door_id in context.processed:
            continue
        opening = context.openings[door_id]
        context.processed.add(door_id)
        context.processed_order.append(door_id)
        target_room_id = next(value for value in opening.room_ids if value != room_id)
        target_visited = target_room_id in context.visited_rooms
        context.machine.emit(
            action=TimedRobotAction(
                type=RobotActionType.SELECT_INTERIOR_DOOR,
                door_local_id=context.opening_local(door_id),
            ),
            duration_ms=_fixed_duration(context, RobotActionType.SELECT_INTERIOR_DOOR),
            updates={"current_door_local_id": context.opening_local(door_id)},
            phase=TraversalPhase.NAVIGATING,
        )
        source_anchor = _configured_anchor(opening, room_id, context.config)
        _timed_move_to(
            context,
            room,
            source_anchor,
            TraversalPhase.NAVIGATING,
            NavigationReason.TO_FRONTIER,
        )
        outward = opening.global_directions[room_id]
        _timed_turn_to(context, outward, TraversalPhase.NAVIGATING, NavigationReason.TO_FRONTIER)
        _timed_cross(context, opening, room_id, target_room_id)
        if not target_visited:
            _timed_explore_room(context, target_room_id, door_id, room_id, depth + 1)
        else:
            _timed_enter_observation(context, target_room_id, door_id, depth, visited=True)
            context.loop_count += 1
            context.machine.emit(
                observation=Observation(
                    type=ObservationType.LOOP_CLOSURE,
                    data={
                        "door_local_id": context.opening_local(door_id),
                        "from_room_local_id": context.room_local(room_id),
                        "to_room_local_id": context.room_local(target_room_id),
                    },
                ),
                duration_ms=0,
                phase=TraversalPhase.LOOP_CLOSING,
            )
            back_heading = opening.global_directions[target_room_id]
            _timed_turn_to(
                context,
                back_heading,
                TraversalPhase.LOOP_CLOSING,
                NavigationReason.LOOP_RETURN,
            )
            _timed_cross(
                context,
                opening,
                target_room_id,
                room_id,
                phase=TraversalPhase.LOOP_CLOSING,
                reason=NavigationReason.LOOP_RETURN,
            )

    if parent_room_id is None:
        return
    parent_door = context.openings[entry_door_id]
    return_anchor = _configured_anchor(parent_door, room_id, context.config)
    _timed_move_to(
        context,
        room,
        return_anchor,
        TraversalPhase.RETURNING,
        NavigationReason.RETURN_TO_PARENT,
    )
    outward = parent_door.global_directions[room_id]
    _timed_turn_to(
        context,
        outward,
        TraversalPhase.RETURNING,
        NavigationReason.RETURN_TO_PARENT,
    )
    _timed_cross(
        context,
        parent_door,
        room_id,
        parent_room_id,
        phase=TraversalPhase.RETURNING,
        reason=NavigationReason.RETURN_TO_PARENT,
        dfs_depth=depth - 1,
    )


def _reachable_rooms(scene: NavigationScene, start_room_id: str) -> set[str]:
    graph: dict[str, set[str]] = {room.id: set() for room in scene.rooms}
    for edge in scene.room_adjacency:
        graph[edge.room_a_id].add(edge.room_b_id)
        graph[edge.room_b_id].add(edge.room_a_id)
    reached = {start_room_id}
    pending = [start_room_id]
    while pending:
        room_id = pending.pop()
        for neighbor in sorted(graph[room_id] - reached):
            reached.add(neighbor)
            pending.append(neighbor)
    return reached


def generate_timed_trajectory(scene: NavigationScene, config: RobotConfig) -> TimedTrajectory:
    """Generate one primary-component canonical DFS trajectory with exact timing."""

    exterior_doors = ordered_exterior_doors(scene)
    ranked = sorted(
        exterior_doors,
        key=lambda opening: (
            -len(_reachable_rooms(scene, opening.room_ids[0])),
            exterior_doors.index(opening),
        ),
    )
    primary = ranked[0]
    primary_room_id = primary.room_ids[0]
    reachable = _reachable_rooms(scene, primary_room_id)
    if reachable != {room.id for room in scene.rooms}:
        raise ValueError(
            "Not every room belongs to the primary exterior door component; "
            "canonical_dfs_time_v1 forbids exterior teleportation"
        )
    outside_anchor = _configured_anchor(primary, None, config)
    room_anchor = _configured_anchor(primary, primary_room_id, config)
    initial_heading = direction_between(outside_anchor, room_anchor)
    machine = TimedStateMachine(
        TimedRobotState(
            position=outside_anchor,
            heading=initial_heading,
            phase=TraversalPhase.OUTSIDE,
        )
    )
    context = _TimedContext(
        scene=scene,
        config=config,
        machine=machine,
        rooms={room.id: room for room in scene.rooms},
        openings={opening.id: opening for opening in scene.openings},
    )
    context.opening_source_to_local[primary.id] = "DOOR_0"
    machine.emit(
        observation=Observation(type=ObservationType.OUTSIDE),
        duration_ms=0,
        phase=TraversalPhase.OUTSIDE,
    )
    machine.emit(
        action=TimedRobotAction(type=RobotActionType.SELECT_EXTERIOR_DOOR, door_local_id="DOOR_0"),
        observation=Observation(
            type=ObservationType.AT_DOOR,
            data={"door_local_id": "DOOR_0", "primary": True},
        ),
        duration_ms=_fixed_duration(context, RobotActionType.SELECT_EXTERIOR_DOOR),
        updates={"current_door_local_id": "DOOR_0"},
        phase=TraversalPhase.OUTSIDE,
    )
    _timed_cross(context, primary, None, primary_room_id)
    first_cross = machine.events[-1]
    if first_cross.state_before.position != outside_anchor:
        raise ValueError("Primary exterior crossing did not start outside")
    _timed_explore_room(context, primary_room_id, primary.id, None, 0)
    root = context.rooms[primary_room_id]
    _timed_move_to(
        context,
        root,
        room_anchor,
        TraversalPhase.RETURNING,
        NavigationReason.RETURN_TO_PRIMARY_EXIT,
    )
    outward = primary.global_directions[primary_room_id]
    _timed_turn_to(
        context,
        outward,
        TraversalPhase.EXITING,
        NavigationReason.RETURN_TO_PRIMARY_EXIT,
    )
    _timed_cross(
        context,
        primary,
        primary_room_id,
        None,
        exiting=True,
        phase=TraversalPhase.EXITING,
        reason=NavigationReason.RETURN_TO_PRIMARY_EXIT,
    )
    machine.emit(
        action=TimedRobotAction(type=RobotActionType.STOP),
        duration_ms=_fixed_duration(context, RobotActionType.STOP),
        phase=TraversalPhase.COMPLETE,
    )
    local_map = LocalEntityMap(
        rooms={local: source for source, local in context.room_source_to_local.items()},
        openings={local: source for source, local in context.opening_source_to_local.items()},
    )
    return TimedTrajectory(
        building_id=scene.building_id,
        robot_config_sha256=robot_config_sha256(config),
        primary_exterior_door_local_id="DOOR_0",
        events=machine.events,
        visited_room_local_ids=list(context.room_source_to_local.values()),
        processed_door_local_ids=[
            context.opening_local(source) for source in context.processed_order
        ],
        loop_closure_count=context.loop_count,
        local_id_map=local_map,
    )
