"""Deterministic scan + strict component DFS; geometry only inside perception."""

from fractions import Fraction as F

from embodied.behavior_token_decoder import boundary_normal, wall_point
from embodied.config import Config
from embodied.exact import (
    duration_tokens,
    rational_tokens,
    string_tokens,
    uint_tokens,
)
from embodied.floorplan import (
    CanonicalFloorplan,
    Opening,
    Room,
    canonicalize_floorplan,
)
from embodied.planner import Position, direction, distance, plan_path, shift
from embodied.scan import ScanDoor, scan_geometry


class Encoder:
    def __init__(self, floorplan: CanonicalFloorplan, config: Config) -> None:
        self.f = canonicalize_floorplan(floorplan)
        self.c = config
        self.rooms = {r.id: r for r in self.f.rooms}
        self.walls = {w.id: w for w in self.f.walls}
        self.openings = {o.id: o for o in self.f.openings}
        self.room_refs: dict[str, int] = {}
        self.wall_refs: dict[str, int] = {}
        self.door_refs: dict[str, int] = {}
        self.window_refs: dict[str, int] = {}
        self.processed: set[str] = set()
        self.t: list[str] = ["<BOS>", "<CODEC_V2>"]
        self.position: Position = (F(0), F(0))
        self.heading = 3

    def center(self, opening: Opening) -> Position:
        return wall_point(
            self.walls[opening.host_wall_id], F(2 * opening.offset_mm + opening.width_mm, 2)
        )

    def side(self, room: Room, opening: Opening) -> tuple[int, F]:
        center_offset = F(2 * opening.offset_mm + opening.width_mm, 2)
        arclength = F(0)
        matches = []
        for boundary in room.boundary:
            if boundary.wall_id == opening.host_wall_id and (
                min(boundary.start_mm, boundary.end_mm)
                <= center_offset
                <= max(boundary.start_mm, boundary.end_mm)
            ):
                matches.append(
                    (
                        boundary_normal(self.walls[boundary.wall_id], boundary),
                        arclength + abs(center_offset - boundary.start_mm),
                    )
                )
            arclength += abs(boundary.end_mm - boundary.start_mm)
        if not matches or len({n for n, _ in matches}) != 1:
            raise ValueError("GEOMETRY_CONFLICT: portal has no unique normal")
        return min(matches)

    def action(self, name: str, duration: F, target: Opening | None = None) -> None:
        self.t.append(f"<ACT_{name}>")
        if target is not None:
            self.t += ["<DOOR>"] + uint_tokens(self.door_refs[target.id])
        self.t += duration_tokens(duration, self.c.duration_bins_ms)

    def turn(self, desired: int) -> None:
        delta = (desired - self.heading) % 4
        if delta:
            name = {1: "TURN_RIGHT", 2: "TURN_BACK", 3: "TURN_LEFT"}[delta]
            self.action(name, self.c.turn_time(min(delta, 4 - delta)))
            self.heading = desired

    def move(self, point: Position) -> None:
        if point != self.position:
            self.turn(direction(self.position, point))
            self.action("MOVE_FORWARD", self.c.move_time(distance(self.position, point)))
            self.position = point

    def scan(self) -> list[str]:
        external = [o for o in self.f.openings if o.opening_type == "exterior_door"]
        if not external:
            raise ValueError("UNREACHABLE_COMPONENT: no exterior door")
        if (
            self.c.exterior_scan_offset_mm
            < self.c.clearance_mm + max(w.thickness_mm for w in self.f.walls) / 2
        ):
            raise ValueError("PATH_INVALID: scan lacks nominal outer wall clearance")
        doors = [
            ScanDoor(
                o.id,
                self.center(o),
                self.side(self.rooms[o.room_ids[0]], o)[0],
                o.width_mm,
                o.model_dump_json(exclude={"id", "room_ids"}),
            )
            for o in external
        ]
        scan = scan_geometry(
            self.f.width_mm, self.f.height_mm, self.c.exterior_scan_offset_mm, doors
        )
        self.position, self.heading = scan.start, 3
        self.t.append("<GLOBAL_SCAN_BEGIN>")
        pending = list(scan.doors)
        total = F(0)
        for end in scan.points[1:]:
            leg_end = total + distance(self.position, end)
            while pending and pending[0].arclength <= leg_end:
                projection = pending.pop(0)
                self.move(projection.point)
                ref = len(self.door_refs)
                self.door_refs[projection.door.id] = ref
                self.t += ["<OBS_EXTERIOR_DOOR>", "<DOOR>"] + uint_tokens(ref)
                self.t += uint_tokens(projection.door.normal) + rational_tokens(projection.depth)
                self.t += uint_tokens(projection.door.width_mm)
            self.move(end)
            total = leg_end
        self.t.append("<GLOBAL_SCAN_END>")
        return [p.door.id for p in scan.doors]

    def components(self, exterior_order: list[str]) -> list[tuple[str, set[str]]]:
        remaining = set(self.rooms)
        result: list[tuple[str, set[str]]] = []
        while remaining:
            reached: set[str] = set()
            queue = [min(remaining)]
            while queue:
                room = queue.pop()
                if room in reached:
                    continue
                reached.add(room)
                for opening in self.f.openings:
                    if (
                        self.passable(opening)
                        and not opening.connects_outside
                        and room in opening.room_ids
                    ):
                        queue.extend(r for r in opening.room_ids if r not in reached)
            entries = [
                key
                for key in exterior_order
                if self.passable(self.openings[key]) and self.openings[key].room_ids[0] in reached
            ]
            if not entries:
                raise ValueError("UNREACHABLE_COMPONENT: indoor component has no usable entrance")
            result.append((entries[0], reached))
            remaining -= reached
        return sorted(result, key=lambda item: exterior_order.index(item[0]))

    @staticmethod
    def passable(opening: Opening) -> bool:
        return opening.opening_type != "exterior_window" and opening.channels.get("people", False)

    def observe(self, room: Room) -> None:
        index = len(self.room_refs)
        self.room_refs[room.id] = index
        self.t += (
            ["<OBS_ENTER_NEW_ROOM>", "<ROOM>"] + uint_tokens(index) + string_tokens(room.function)
        )
        observed: set[str] = set()
        for relative, look in ((2, None), (0, "LOOK_FRONT"), (-1, "LOOK_LEFT"), (1, "LOOK_RIGHT")):
            if look is None:
                self.t.append("<OBS_ENTRY_WALL>")
            else:
                self.action(look, F(self.c.look_ms))
            normal = (self.heading + relative) % 4
            for edge, boundary in enumerate(room.boundary):
                wall = self.walls[boundary.wall_id]
                if boundary_normal(wall, boundary) != normal:
                    continue
                self.t += ["<OBS_WALL>", "<EDGE>"] + uint_tokens(edge) + ["<WALL>"]
                is_new = wall.id not in self.wall_refs
                if is_new:
                    self.wall_refs[wall.id] = len(self.wall_refs)
                self.t += uint_tokens(self.wall_refs[wall.id])
                if is_new:
                    self.t.append("<NEW_HOST>")
                    self.t += rational_tokens(wall.start[0] - self.position[0])
                    self.t += rational_tokens(wall.start[1] - self.position[1])
                    self.t += uint_tokens(1 if wall.start[1] == wall.end[1] else 0)
                    self.t += uint_tokens(
                        abs(wall.start[0] - wall.end[0]) + abs(wall.start[1] - wall.end[1])
                    )
                    self.t += string_tokens(wall.wall_type) + uint_tokens(wall.thickness_mm)
                    self.t += uint_tokens(wall.height_mm) + string_tokens(wall.material_type)
                self.t += (
                    ["<INTERVAL>"] + uint_tokens(boundary.start_mm) + uint_tokens(boundary.end_mm)
                )
                for opening in self.f.openings:
                    if (
                        opening.id in observed
                        or opening.host_wall_id != wall.id
                        or room.id not in opening.room_ids
                    ):
                        continue
                    offset = F(2 * opening.offset_mm + opening.width_mm, 2)
                    if (
                        not min(boundary.start_mm, boundary.end_mm)
                        <= offset
                        <= max(boundary.start_mm, boundary.end_mm)
                    ):
                        continue
                    observed.add(opening.id)
                    self.observe_opening(opening)
                self.t.append("<END_WALL>")
        if observed != {o.id for o in self.f.openings if room.id in o.room_ids}:
            raise ValueError("UNOBSERVABLE_GEOMETRY: incomplete opening perception")

    def observe_opening(self, opening: Opening) -> None:
        is_door = opening.opening_type != "exterior_window"
        refs = self.door_refs if is_door else self.window_refs
        if opening.id not in refs:
            refs[opening.id] = len(refs)
        self.t += ["<OBS_OPENING>", "<DOOR>" if is_door else "<OPENING>"] + uint_tokens(
            refs[opening.id]
        )
        self.t += string_tokens(opening.opening_type)
        for value in (
            opening.offset_mm,
            opening.width_mm,
            opening.height_mm,
            opening.sill_height_mm,
        ):
            self.t += uint_tokens(value)
        self.t += ["<TRUE>" if opening.connects_outside else "<FALSE>"]
        self.t += uint_tokens(len(opening.channels))
        for key, value in sorted(opening.channels.items()):
            self.t += string_tokens(key) + ["<TRUE>" if value else "<FALSE>"]

    def navigate(self, room: Room, door: Opening) -> None:
        normal, _ = self.side(room, door)
        anchor = shift(self.center(door), normal, -F(self.c.anchor_offset_mm))
        path = plan_path(room.polygon, self.position, anchor, self.heading, normal, self.c)
        for point in path[1:]:
            self.move(point)
        self.turn(normal)

    def cross(self, door: Opening, *, exiting: bool = False) -> None:
        if door.width_mm < 2 * self.c.clearance_mm:
            raise ValueError("DOOR_CLEARANCE_INVALID: narrow portal")
        self.action(
            "EXIT_BUILDING" if exiting else "CROSS_DOOR",
            self.c.move_time(F(2 * self.c.anchor_offset_mm), crossing=True),
            door,
        )
        self.position = shift(self.position, self.heading, F(2 * self.c.anchor_offset_mm))

    def visited(self, room: Room) -> None:
        self.t += ["<OBS_ENTER_VISITED_ROOM>", "<ROOM>"] + uint_tokens(self.room_refs[room.id])

    def explore(self, room: Room, entry: Opening) -> None:
        self.observe(room)
        perimeter = sum(abs(b.end_mm - b.start_mm) for b in room.boundary)
        _, entry_s = self.side(room, entry)
        doors = [
            o
            for o in self.f.openings
            if room.id in o.room_ids
            and not o.connects_outside
            and o.id != entry.id
            and self.passable(o)
        ]
        doors.sort(key=lambda o: ((entry_s - self.side(room, o)[1]) % perimeter, o.id))
        for door in doors:
            if door.id in self.processed:
                continue
            self.processed.add(door.id)
            other = self.rooms[next(r for r in door.room_ids if r != room.id)]
            self.action("SELECT_INTERIOR_DOOR", F(self.c.select_ms), door)
            self.navigate(room, door)
            self.cross(door)
            if other.id not in self.room_refs:
                self.explore(other, door)
            else:
                self.visited(other)
                self.t += ["<OBS_LOOP_CLOSURE>", "<DOOR>"] + uint_tokens(self.door_refs[door.id])
            self.navigate(other, door)
            self.cross(door)
            self.visited(room)

    def encode(self) -> list[str]:
        exterior_order = self.scan()
        for entry_id, component in self.components(exterior_order):
            entry = self.openings[entry_id]
            room = self.rooms[entry.room_ids[0]]
            normal, _ = self.side(room, entry)
            self.position = shift(self.center(entry), normal, F(self.c.anchor_offset_mm))
            self.heading = (normal + 2) % 4
            self.t += ["<EPISODE_RESET>", "<EPISODE_BEGIN>", "<ENTRY>", "<DOOR>"]
            self.t += uint_tokens(self.door_refs[entry.id])
            self.cross(entry)
            self.explore(room, entry)
            if not component <= self.room_refs.keys():
                raise ValueError("UNREACHABLE_COMPONENT: incomplete DFS")
            self.navigate(room, entry)
            self.cross(entry, exiting=True)
            self.action("STOP", F(0))
            self.t.append("<EPISODE_END>")
        return self.t + ["<BUILDING_END>", "<EOS>"]


def encode_floorplan(floorplan: CanonicalFloorplan, config: Config) -> list[str]:
    return Encoder(floorplan, config).encode()
