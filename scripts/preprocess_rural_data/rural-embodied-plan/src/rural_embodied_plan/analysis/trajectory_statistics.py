"""Traversal statistics and completeness validation."""

from typing import Any

from shapely import Polygon
from shapely.geometry import LineString

from rural_embodied_plan.config import RobotConfig
from rural_embodied_plan.domain.geometry import Point2D, RelativeDirection
from rural_embodied_plan.domain.navigation import NavigationScene
from rural_embodied_plan.domain.robot import ObservationType, RobotActionType, TraversalPhase
from rural_embodied_plan.domain.trajectory import TimedTrajectory, Trajectory
from rural_embodied_plan.geometry.directions import direction_between, opposite, turn, vector
from rural_embodied_plan.timing import movement_duration_ms, turn_duration_ms


def trajectory_statistics(trajectory: Trajectory) -> dict[str, Any]:
    """Return stable trajectory counts."""

    action_count = sum(event.action is not None for event in trajectory.events)
    observation_count = sum(event.observation is not None for event in trajectory.events)
    return {
        "event_count": len(trajectory.events),
        "action_count": action_count,
        "observation_count": observation_count,
        "visited_room_count": len(trajectory.visited_room_ids),
        "traversed_room_count": sum(
            activation.access_mode == "traversed" for activation in trajectory.room_activations
        ),
        "visual_only_room_count": sum(
            activation.access_mode == "visual_only" for activation in trajectory.room_activations
        ),
        "processed_interior_door_count": len(trajectory.processed_interior_door_ids),
        "loop_closure_count": trajectory.loop_closure_count,
    }


def validate_trajectory(scene: NavigationScene, trajectory: Trajectory) -> list[str]:
    """Return exploration completeness errors."""

    errors: list[str] = []
    if set(trajectory.visited_room_ids) != {room.id for room in scene.rooms}:
        errors.append("Not every room was visited exactly once")
    if len(trajectory.room_activations) != len(scene.rooms):
        errors.append("Room first-activation count differs from scene room count")
    if set(trajectory.processed_interior_door_ids) != set(scene.interior_doors):
        errors.append("Not every interior door was processed")
    final = trajectory.events[-1] if trajectory.events else None
    if final is None or final.action is None or final.action.type != RobotActionType.STOP:
        errors.append("Final action is not STOP")
    elif final.state_after.current_room_id is not None:
        errors.append("Robot did not finish outside")
    elif final.state_after.phase != TraversalPhase.COMPLETE:
        errors.append("Robot final phase is not COMPLETE")
    observed_ids = set(final.state_after.visited_door_ids) if final is not None else set()
    if not set(scene.exterior_doors + scene.interior_doors).issubset(observed_ids):
        errors.append("Not every door was observed")
    return errors


def _anchor(scene_opening: Any, room_id: str | None, config: RobotConfig) -> Point2D:
    attached_room = scene_opening.room_ids[0] if room_id is None else room_id
    direction = scene_opening.global_directions[attached_room]
    if room_id is not None:
        direction = opposite(direction)
    dx, dy = vector(direction)
    return Point2D(
        x_mm=scene_opening.center.x_mm + dx * config.geometry.door_anchor_offset_mm,
        y_mm=scene_opening.center.y_mm + dy * config.geometry.door_anchor_offset_mm,
    )


def validate_timed_trajectory(
    scene: NavigationScene, trajectory: TimedTrajectory, config: RobotConfig
) -> list[str]:
    """Return physical, temporal, DFS-completeness, and terminal-state errors."""

    errors: list[str] = []
    rooms = {room.id: room for room in scene.rooms}
    openings = {opening.id: opening for opening in scene.openings}
    local_to_room = trajectory.local_id_map.rooms
    local_to_opening = trajectory.local_id_map.openings
    if set(local_to_room.values()) != set(rooms):
        errors.append("Timed trajectory local room map does not cover every scene room")
    if trajectory.visited_room_local_ids != list(local_to_room):
        errors.append("Visited room order differs from local room allocation order")
    processed_sources = {
        local_to_opening.get(local_id) for local_id in trajectory.processed_door_local_ids
    }
    if processed_sources != set(scene.interior_doors):
        errors.append("Not every required interior door was processed exactly once")
    if trajectory.primary_exterior_door_local_id not in local_to_opening:
        errors.append("Primary exterior door local ID is missing from the audit map")

    previous_end = 0
    previous_state = None
    discovered_rooms: set[str] = set()
    for index, event in enumerate(trajectory.events):
        prefix = f"Event {index}: "
        if event.step != index:
            errors.append(prefix + "step index is not contiguous")
        if event.timing.start_ms != previous_end:
            errors.append(prefix + "Timeline is not contiguous")
        if event.timing.end_ms != event.timing.start_ms + event.timing.duration_ms:
            errors.append(prefix + "timing end does not equal start plus duration")
        if event.state_before.elapsed_ms != event.timing.start_ms:
            errors.append(prefix + "state_before elapsed time differs from event start")
        if event.state_after.elapsed_ms != event.timing.end_ms:
            errors.append(prefix + "state_after elapsed time differs from event end")
        if previous_state is not None and event.state_before != previous_state:
            errors.append(prefix + "trajectory state is discontinuous")
        if event.phase != event.state_after.phase:
            errors.append(prefix + "event phase differs from executing state phase")
        previous_end = event.timing.end_ms
        previous_state = event.state_after

        before_room = event.state_before.current_room_local_id
        if before_room is not None and before_room not in discovered_rooms:
            errors.append(prefix + "room local ID appeared before ENTER_NEW_ROOM")
        if (
            event.observation is not None
            and event.observation.type == ObservationType.ENTER_NEW_ROOM
        ):
            entered_room = event.observation.data.get("room_local_id")
            if not isinstance(entered_room, str):
                errors.append(prefix + "ENTER_NEW_ROOM is missing its local room ID")
            else:
                if entered_room in discovered_rooms:
                    errors.append(prefix + "ENTER_NEW_ROOM repeats a discovered room")
                if event.state_before.current_room_local_id is not None:
                    errors.append(prefix + "new room was exposed before ENTER_NEW_ROOM")
                discovered_rooms.add(entered_room)
                if event.state_after.current_room_local_id != entered_room:
                    errors.append(prefix + "ENTER_NEW_ROOM did not activate its local room ID")
        else:
            after_room = event.state_after.current_room_local_id
            if after_room is not None and after_room not in discovered_rooms:
                errors.append(prefix + "room local ID appeared before ENTER_NEW_ROOM")

        action = event.action
        if action is None:
            if event.timing.duration_ms != 0:
                errors.append(prefix + "observation-only event must have zero duration")
            continue
        before = event.state_before
        after = event.state_after
        if (
            action.type
            in {
                RobotActionType.SELECT_EXTERIOR_DOOR,
                RobotActionType.SELECT_INTERIOR_DOOR,
                RobotActionType.CROSS_DOOR,
                RobotActionType.EXIT_BUILDING,
            }
            and action.target_room_local_id is not None
        ):
            errors.append(prefix + "action exposes a room target before entry observation")
        distance = abs(after.position.x_mm - before.position.x_mm) + abs(
            after.position.y_mm - before.position.y_mm
        )
        if action.type == RobotActionType.MOVE_FORWARD:
            if action.distance_mm != distance:
                errors.append(prefix + "MOVE_FORWARD distance differs from state delta")
            if before.heading != after.heading:
                errors.append(prefix + "MOVE_FORWARD changed heading")
            if (
                distance > 0
                and direction_between(before.position, after.position) != before.heading
            ):
                errors.append(prefix + "MOVE_FORWARD displacement disagrees with heading")
            expected = movement_duration_ms(distance, config.dynamics.linear_speed_mm_per_s)
            if event.timing.duration_ms != expected:
                errors.append(prefix + "MOVE_FORWARD duration is inconsistent with distance")
            room_source = local_to_room.get(before.current_room_local_id or "")
            if room_source in rooms:
                free = Polygon(
                    [(point.x_mm, point.y_mm) for point in rooms[room_source].polygon]
                ).buffer(-config.geometry.clearance_mm, join_style="mitre")
                line = LineString(
                    [
                        (before.position.x_mm, before.position.y_mm),
                        (after.position.x_mm, after.position.y_mm),
                    ]
                )
                if not free.covers(line):
                    errors.append(prefix + "MOVE_FORWARD is not collision-free")
        elif action.type in {
            RobotActionType.TURN_LEFT,
            RobotActionType.TURN_RIGHT,
            RobotActionType.TURN_BACK,
        }:
            relative = {
                RobotActionType.TURN_LEFT: RelativeDirection.LEFT,
                RobotActionType.TURN_RIGHT: RelativeDirection.RIGHT,
                RobotActionType.TURN_BACK: RelativeDirection.BACK,
            }[action.type]
            angle = 180000 if relative == RelativeDirection.BACK else 90000
            if action.turn_angle_mdeg != angle:
                errors.append(prefix + "TURN angle is inconsistent with action type")
            if before.position != after.position:
                errors.append(prefix + "TURN changed position")
            if after.heading != turn(before.heading, relative):
                errors.append(prefix + "TURN heading transition is invalid")
            expected = turn_duration_ms(angle, config.dynamics.angular_speed_mdeg_per_s)
            if event.timing.duration_ms != expected:
                errors.append(prefix + "TURN duration is inconsistent with angle")
        elif action.type in {RobotActionType.CROSS_DOOR, RobotActionType.EXIT_BUILDING}:
            if action.distance_mm != distance:
                errors.append(prefix + "Door crossing distance differs from state delta")
            expected = movement_duration_ms(distance, config.dynamics.door_crossing_speed_mm_per_s)
            if event.timing.duration_ms != expected:
                errors.append(prefix + "Door crossing duration is inconsistent with distance")
            if before.heading != after.heading:
                errors.append(prefix + "Door crossing changed heading implicitly")
            source_id = local_to_opening.get(action.door_local_id or "")
            opening = openings.get(source_id or "")
            before_room = local_to_room.get(before.current_room_local_id or "")
            if opening is None:
                errors.append(prefix + "Door crossing references an unknown local door")
            else:
                expected_before = _anchor(opening, before_room, config)
                if action.type == RobotActionType.EXIT_BUILDING:
                    target_room = None
                elif before_room is None:
                    target_room = opening.room_ids[0]
                else:
                    target_room = next(
                        room_id for room_id in opening.room_ids if room_id != before_room
                    )
                expected_after = _anchor(opening, target_room, config)
                if before.position != expected_before or after.position != expected_after:
                    errors.append(prefix + "Door crossing endpoints do not match anchors")
            if action.type == RobotActionType.EXIT_BUILDING:
                if action.door_local_id != trajectory.primary_exterior_door_local_id:
                    errors.append(prefix + "Robot exited through a non-primary exterior door")
                if after.current_room_local_id is not None:
                    errors.append(prefix + "EXIT_BUILDING did not finish outside")
        else:
            expected = config.fixed_action_duration_ms.get(action.type.value, 0)
            if event.timing.duration_ms != expected:
                errors.append(prefix + f"{action.type.value} duration differs from config")
            if before.position != after.position or before.heading != after.heading:
                errors.append(prefix + f"{action.type.value} changed physical pose")
        if action.type == RobotActionType.BACKTRACK:
            errors.append(prefix + "BACKTRACK is not a physical canonical action")

    final = trajectory.events[-1] if trajectory.events else None
    if final is None or final.action is None or final.action.type != RobotActionType.STOP:
        errors.append("Timed trajectory does not end with STOP")
    elif final.phase != TraversalPhase.COMPLETE:
        errors.append("Final timed trajectory phase is not COMPLETE")
    elif final.state_after.current_room_local_id is not None:
        errors.append("Robot did not finish outside")
    return errors
