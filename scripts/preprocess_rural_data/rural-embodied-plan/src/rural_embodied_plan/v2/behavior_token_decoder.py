"""Streaming reconstruction from tokens and dynamics only; no source/scene reader."""

from fractions import Fraction as F
from typing import Any, Literal, cast

from rural_embodied_plan.v2.config import V2Config
from rural_embodied_plan.v2.exact import Reader, fail
from rural_embodied_plan.v2.floorplan import (
    Boundary,
    CanonicalFloorplan,
    Opening,
    Room,
    Wall,
    canonicalize_floorplan,
)
from rural_embodied_plan.v2.physical import validate_crossing
from rural_embodied_plan.v2.planner import Position, collision_free, shift
from rural_embodied_plan.v2.scan import ScanDoor, scan_geometry


def integer(value: F) -> int:
    if value.denominator != 1:
        fail("canonical floorplan field is not integer mm")
    return value.numerator


def wall_point(wall: Wall, offset: int | F) -> Position:
    axis = 1 if wall.start[1] == wall.end[1] else 0
    return shift((F(wall.start[0]), F(wall.start[1])), axis, F(offset))


def boundary_normal(wall: Wall, boundary: Boundary) -> int:
    axis = 1 if wall.start[1] == wall.end[1] else 0
    tangent = axis if boundary.end_mm > boundary.start_mm else (axis + 2) % 4
    return (tangent + 1) % 4  # right-hand outward normal of CCW boundary


class Decoder:
    def __init__(self, tokens: list[str], config: V2Config) -> None:
        self.r = Reader(tokens)
        self.config = config
        self.position: Position = (F(0), F(0))
        self.heading = 3
        self.elapsed = F(0)
        self.session = 0
        self.current: int | None = None
        self.pending: int | None = None
        self.entry = -1
        self.functions: dict[int, str | None] = {}
        self.boundaries: dict[int, dict[int, Boundary]] = {}
        self.walls: dict[int, Wall] = {}
        self.openings: dict[tuple[str, int], Opening] = {}
        self.scanned: dict[int, tuple[Position, int, int]] = {}
        self.known_doors: set[int] = set()
        self.events: list[dict[str, Any]] = []
        self.sensor = -1
        self.stopped = False
        self.exited = False

    def snapshot(self) -> dict[str, Any]:
        return {
            "position_mm": self.position,
            "heading": self.heading,
            "room_local_id": self.current,
        }

    def ref(self, kind: str) -> int:
        self.r.expect(f"<{kind}>")
        return self.r.uint()

    def record_observation(self, kind: str, before: dict[str, Any], start: int) -> None:
        self.events.append(
            {
                "session": self.session,
                "action": None,
                "target": None,
                "observation": {"type": kind, "tokens": self.r.tokens[start : self.r.index]},
                "start_ms": self.elapsed,
                "duration_ms": F(0),
                "end_ms": self.elapsed,
                "state_before": before,
                "state_after": self.snapshot(),
            }
        )

    def action(self, *, scan: bool = False) -> str:
        token = self.r.take()
        name = token.removeprefix("<ACT_").removesuffix(">")
        legal = {
            "MOVE_FORWARD",
            "TURN_LEFT",
            "TURN_RIGHT",
            "TURN_BACK",
            "CROSS_DOOR",
            "EXIT_BUILDING",
            "LOOK_FRONT",
            "LOOK_LEFT",
            "LOOK_RIGHT",
            "SELECT_INTERIOR_DOOR",
            "STOP",
        }
        if name not in legal or scan and name not in {"MOVE_FORWARD", "TURN_RIGHT"}:
            fail(f"illegal action {token}")
        if self.pending is not None or self.stopped:
            fail("action before room discovery or after STOP")
        if self.exited and name != "STOP":
            fail("only STOP is allowed after EXIT")
        target = None
        if name in {"CROSS_DOOR", "EXIT_BUILDING", "SELECT_INTERIOR_DOOR"}:
            target = self.ref("DOOR")
            if target not in self.known_doors:
                fail("target door not discovered")
        dt = self.r.duration(self.config.duration_bins_ms)
        before = self.snapshot()
        expected = dt
        if name == "MOVE_FORWARD":
            if dt <= 0 or not scan and self.current is None:
                fail("MOVE must be positive and inside an active room")
            self.position = shift(
                self.position, self.heading, dt * self.config.linear_speed_mm_s / 1000
            )
        elif name.startswith("TURN_"):
            delta = {"TURN_LEFT": -1, "TURN_RIGHT": 1, "TURN_BACK": 2}[name]
            expected = self.config.turn_time(abs(delta))
            self.heading = (self.heading + delta) % 4
        elif name.startswith("LOOK_"):
            if self.current is None:
                fail("LOOK outside active room")
            self.sensor = (
                self.heading + {"LOOK_FRONT": 0, "LOOK_LEFT": -1, "LOOK_RIGHT": 1}[name]
            ) % 4
            expected = F(self.config.look_ms)
        elif name == "SELECT_INTERIOR_DOOR":
            expected = F(self.config.select_ms)
            if self.current is None or ("DOOR", target) not in self.openings:
                fail("SELECT lacks current-room observation")
        elif name in {"CROSS_DOOR", "EXIT_BUILDING"}:
            assert target is not None
            center, outward = self.portal(target)
            if self.current is None:
                required = (outward + 2) % 4
                anchor = shift(center, outward, F(self.config.anchor_offset_mm))
            else:
                required = outward
                anchor = shift(center, outward, -F(self.config.anchor_offset_mm))
            if self.position != anchor or self.heading != required:
                fail("CROSS pose/heading does not match observed portal")
            expected = self.config.move_time(F(2 * self.config.anchor_offset_mm), crossing=True)
            self.position = shift(self.position, self.heading, F(2 * self.config.anchor_offset_mm))
            if name == "EXIT_BUILDING":
                if target != self.entry or self.current is None or target not in self.scanned:
                    fail("EXIT must use this episode's exterior entrance")
                self.current = None
                self.exited = True
            else:
                self.pending = target
                self.current = None
        elif name == "STOP":
            if self.current is not None or not self.exited:
                fail("STOP before EXIT")
            expected = F(0)
            self.stopped = True
        if dt != expected:
            fail(f"{name} duration violates dynamics")
        self.events.append(
            {
                "session": self.session,
                "action": name,
                "target": target,
                "start_ms": self.elapsed,
                "duration_ms": dt,
                "end_ms": self.elapsed + dt,
                "state_before": before,
                "state_after": self.snapshot(),
            }
        )
        self.elapsed += dt
        return name

    def portal(self, target: int) -> tuple[Position, int]:
        if self.current is None:
            if target != self.entry or target not in self.scanned:
                fail("outside CROSS is not episode entrance")
            center, normal, width = self.scanned[target]
        else:
            opening = self.openings.get(("DOOR", target))
            if opening is None or f"R{self.current}" not in opening.room_ids:
                fail("door not observed from current room")
            if not opening.channels.get("people", False):
                fail("door is not traversable")
            wall = next(w for w in self.walls.values() if w.id == opening.host_wall_id)
            center_offset = F(2 * opening.offset_mm + opening.width_mm, 2)
            matching = [
                b
                for b in self.boundaries[self.current].values()
                if b.wall_id == wall.id
                and min(b.start_mm, b.end_mm) <= center_offset <= max(b.start_mm, b.end_mm)
            ]
            if not matching or len({boundary_normal(wall, b) for b in matching}) != 1:
                fail("door has ambiguous room-side host")
            normal = boundary_normal(wall, matching[0])
            center = wall_point(wall, F(2 * opening.offset_mm + opening.width_mm, 2))
            width = opening.width_mm
        if width < 2 * self.config.clearance_mm:
            raise ValueError("DOOR_CLEARANCE_INVALID: portal too narrow")
        return center, normal

    def scan(self) -> tuple[int, int]:
        self.r.expect("<BOS>")
        self.r.expect("<CODEC_V2>")
        self.r.expect("<GLOBAL_SCAN_BEGIN>")
        legs = [F(0)]
        while self.r.peek() != "<GLOBAL_SCAN_END>":
            if self.r.peek() == "<OBS_EXTERIOR_DOOR>":
                before, token_start = self.snapshot(), self.r.index
                self.r.take()
                index = self.ref("DOOR")
                if index != len(self.scanned):
                    fail("noncanonical exterior discovery ID")
                normal, depth, width = self.r.uint(), self.r.rational(), self.r.uint()
                if normal not in range(4) or depth <= 0 or width <= 0:
                    fail("invalid exterior door observation")
                self.scanned[index] = (shift(self.position, normal, -depth), normal, width)
                self.known_doors.add(index)
                self.record_observation("EXTERIOR_DOOR", before, token_start)
            else:
                prior_position = self.position
                name = self.action(scan=True)
                if name == "TURN_RIGHT":
                    legs.append(F(0))
                else:
                    legs[-1] += abs(self.position[0] - prior_position[0]) + abs(
                        self.position[1] - prior_position[1]
                    )
        self.r.expect("<GLOBAL_SCAN_END>")
        if len(legs) != 5 or min(legs) <= 0 or self.position != (F(0), F(0)) or self.heading != 3:
            fail("scan must be a closed five-leg rectangle")
        a, b, c, d, e = legs
        o = self.config.exterior_scan_offset_mm
        if a != e or b != d or 2 * a != c:
            fail("scan leg symmetry mismatch")
        width, height = integer(c - 2 * o), integer(b - 2 * o)
        if min(width, height) <= 0:
            fail("invalid reconstructed bbox")
        delta = (F(width, 2), F(-o))
        self.scanned = {
            i: ((p[0] + delta[0], p[1] + delta[1]), n, w) for i, (p, n, w) in self.scanned.items()
        }
        for event in self.events:
            for key in ("state_before", "state_after"):
                p = event[key]["position_mm"]
                event[key]["position_mm"] = (p[0] + delta[0], p[1] + delta[1])
        canonical_scan = scan_geometry(
            width,
            height,
            o,
            [
                ScanDoor(str(i), center, normal, door_width)
                for i, (center, normal, door_width) in self.scanned.items()
            ],
        )
        observed_positions = [
            e["state_before"]["position_mm"]
            for e in self.events
            if e.get("observation", {}).get("type") == "EXTERIOR_DOOR"
        ]
        if [p.point for p in canonical_scan.doors] != observed_positions or [
            p.door.id for p in canonical_scan.doors
        ] != [str(i) for i in range(len(self.scanned))]:
            fail("exterior projection position/order mismatch")
        return width, height

    def room_observation(self, new: bool) -> None:
        before, token_start = self.snapshot(), self.r.index
        self.r.take()
        index = self.ref("ROOM")
        if self.pending is None:
            fail("ROOM discovery without physical crossing")
        if new:
            if index != len(self.functions):
                fail("ROOM ID must be allocated after first entry")
            self.functions[index] = self.r.string()
            self.boundaries[index] = {}
        elif index not in self.functions:
            fail("visited ROOM does not exist")
        self.current = index
        self.pending = None
        self.sensor = -1
        self.record_observation(
            "ENTER_NEW_ROOM" if new else "ENTER_VISITED_ROOM", before, token_start
        )

    def observe_wall(self) -> None:
        before, token_start = self.snapshot(), self.r.index
        if self.current is None or self.sensor < 0:
            fail("wall payload outside a room sensor context")
        self.r.expect("<OBS_WALL>")
        edge = self.ref("EDGE")
        wi = self.ref("WALL")
        if self.r.peek() == "<NEW_HOST>":
            self.r.take()
            if wi != len(self.walls):
                fail("noncanonical new WALL ID")
            dx, dy = self.r.rational(), self.r.rational()
            axis, length = self.r.uint(), self.r.uint()
            if axis not in (0, 1) or length <= 0:
                fail("invalid wall axis/length")
            start = (integer(self.position[0] + dx), integer(self.position[1] + dy))
            end = shift((F(start[0]), F(start[1])), axis, F(length))
            wall_type = self.r.string()
            thick, height, material = self.r.uint(), self.r.uint(), self.r.string()
            if wall_type is None or material is None:
                fail("wall attributes cannot be null")
            self.walls[wi] = Wall(
                id=f"W{wi}",
                start=start,
                end=(integer(end[0]), integer(end[1])),
                wall_type=wall_type,
                thickness_mm=thick,
                height_mm=height,
                material_type=material,
            )
        if wi not in self.walls:
            fail("unknown WALL reference")
        wall = self.walls[wi]
        self.r.expect("<INTERVAL>")
        boundary = Boundary(wall_id=wall.id, start_mm=self.r.uint(), end_mm=self.r.uint())
        if edge in self.boundaries[self.current] or boundary_normal(wall, boundary) != self.sensor:
            fail("duplicate edge or inconsistent sensor direction")
        self.boundaries[self.current][edge] = boundary
        while self.r.peek() == "<OBS_OPENING>":
            self.observe_opening(wall)
        self.r.expect("<END_WALL>")
        self.record_observation("WALL", before, token_start)

    def observe_opening(self, wall: Wall) -> None:
        self.r.take()
        kind = self.r.take()
        if kind not in ("<DOOR>", "<OPENING>"):
            fail("invalid opening namespace")
        namespace, index = kind[1:-1], self.r.uint()
        opening_type = self.r.string()
        if opening_type not in {"exterior_door", "interior_door", "exterior_window", "passage"}:
            fail("invalid opening type")
        if (namespace == "OPENING") != (opening_type == "exterior_window"):
            fail("opening type/namespace mismatch")
        offset, width, height, sill = (self.r.uint() for _ in range(4))
        outside = self.boolean()
        channels: dict[str, bool] = {}
        for _ in range(self.r.uint()):
            key = self.r.string()
            if key is None or key in channels:
                fail("invalid channel key")
            channels[key] = self.boolean()
        assert self.current is not None
        key_id = (namespace, index)
        typed_opening = cast(
            Literal["exterior_door", "interior_door", "exterior_window", "passage"], opening_type
        )
        opening = Opening(
            id=f"{namespace}{index}",
            opening_type=typed_opening,
            host_wall_id=wall.id,
            offset_mm=offset,
            width_mm=width,
            height_mm=height,
            sill_height_mm=sill,
            room_ids=(f"R{self.current}",),
            connects_outside=outside,
            channels=channels,
        )
        previous = self.openings.get(key_id)
        if previous:
            if previous.model_dump(exclude={"room_ids"}) != opening.model_dump(
                exclude={"room_ids"}
            ):
                fail("conflicting shared opening geometry")
            if f"R{self.current}" in previous.room_ids:
                fail("duplicate opening observation from same room")
            opening = opening.model_copy(
                update={"room_ids": (*previous.room_ids, f"R{self.current}")}
            )
        elif namespace == "DOOR":
            if index not in self.known_doors and index != len(self.known_doors):
                fail("noncanonical DOOR ID")
            self.known_doors.add(index)
        elif index != sum(ns == "OPENING" for ns, _ in self.openings):
            fail("noncanonical OPENING ID")
        self.openings[key_id] = opening
        if outside and namespace == "DOOR":
            center = wall_point(wall, F(2 * offset + width, 2))
            if index not in self.scanned or self.scanned[index] != (center, self.sensor, width):
                fail("exterior scan/indoor observation mismatch")

    def boolean(self) -> bool:
        token = self.r.take()
        if token not in ("<TRUE>", "<FALSE>"):
            fail("expected boolean")
        return token == "<TRUE>"

    def decode(self) -> CanonicalFloorplan:
        width, height = self.scan()
        while self.r.peek() == "<EPISODE_RESET>":
            self.r.take()
            self.r.expect("<EPISODE_BEGIN>")
            self.r.expect("<ENTRY>")
            self.entry = self.ref("DOOR")
            if self.entry not in self.scanned:
                fail("episode entrance not found in global scan")
            center, normal, _ = self.scanned[self.entry]
            self.position = shift(center, normal, F(self.config.anchor_offset_mm))
            self.heading = (normal + 2) % 4
            self.current, self.pending = None, None
            self.elapsed, self.stopped = F(0), False
            self.exited = False
            self.session += 1
            while self.r.peek() != "<EPISODE_END>":
                token = self.r.peek()
                if token.startswith("<ACT_"):
                    self.action()
                elif token in ("<OBS_ENTER_NEW_ROOM>", "<OBS_ENTER_VISITED_ROOM>"):
                    self.room_observation(token == "<OBS_ENTER_NEW_ROOM>")
                elif token == "<OBS_ENTRY_WALL>":
                    before, token_start = self.snapshot(), self.r.index
                    self.r.take()
                    if self.current is None:
                        fail("ENTRY_WALL without room")
                    self.sensor = (self.heading + 2) % 4
                    self.record_observation("ENTRY_WALL", before, token_start)
                elif token == "<OBS_WALL>":
                    self.observe_wall()
                elif token == "<OBS_LOOP_CLOSURE>":
                    before, token_start = self.snapshot(), self.r.index
                    self.r.take()
                    if self.current is None or self.ref("DOOR") not in self.known_doors:
                        fail("invalid loop closure")
                    self.record_observation("LOOP_CLOSURE", before, token_start)
                else:
                    fail(f"unexpected episode token {token}")
            self.r.take()
            if not self.stopped or self.pending is not None:
                fail("episode did not terminate with EXIT and STOP")
        self.r.expect("<BUILDING_END>")
        self.r.expect("<EOS>")
        self.r.finish()
        if not self.session or not self.functions:
            fail("building has no indoor episode")
        rooms = []
        walls = {wall.id: wall for wall in self.walls.values()}
        for index, function in self.functions.items():
            edges = self.boundaries[index]
            if sorted(edges) != list(range(len(edges))):
                fail("noncontiguous room boundary indices")
            boundary = tuple(edges[i] for i in range(len(edges)))
            vertices = [wall_point(walls[b.wall_id], b.start_mm) for b in boundary]
            ends = [wall_point(walls[b.wall_id], b.end_mm) for b in boundary]
            if not vertices or ends != [*vertices[1:], vertices[0]]:
                fail("UNRECOVERABLE_ROOM_BOUNDARY: boundary not closed")
            rooms.append(
                Room(
                    id=f"R{index}",
                    function=function,
                    boundary=boundary,
                    polygon=tuple((integer(x), integer(y)) for x, y in vertices),
                )
            )
        raw = CanonicalFloorplan(
            rooms=tuple(rooms),
            walls=tuple(walls.values()),
            openings=tuple(self.openings.values()),
            width_mm=width,
            height_mm=height,
        )
        if set(self.scanned) != {
            i
            for (ns, i), opening in self.openings.items()
            if ns == "DOOR" and opening.connects_outside
        }:
            fail("unresolved exterior scan discovery")
        result = canonicalize_floorplan(raw)
        if (result.width_mm, result.height_mm) != (width, height):
            fail("scan bbox disagrees with reconstructed geometry")
        room_map = {int(room.id[1:]): room for room in rooms}
        for event in self.events:
            before, after = event["state_before"], event["state_after"]
            if event["action"] == "MOVE_FORWARD" and event["session"]:
                room = room_map[before["room_local_id"]]
                if not collision_free(
                    room.polygon, before["position_mm"], after["position_mm"], self.config
                ):
                    raise ValueError("PATH_INVALID: decoded MOVE crosses clearance boundary")
            if event["action"] in {"CROSS_DOOR", "EXIT_BUILDING"}:
                opening = self.openings[("DOOR", event["target"])]
                validate_crossing(
                    raw, opening, before["position_mm"], after["position_mm"], self.config
                )
            if event.get("observation", {}).get("type") in {"ENTER_NEW_ROOM", "ENTER_VISITED_ROOM"}:
                room = room_map[after["room_local_id"]]
                if not collision_free(
                    room.polygon, after["position_mm"], after["position_mm"], self.config
                ):
                    raise ValueError("PATH_INVALID: discovered room anchor outside clearance")
        return result


def decode_behavior_tokens(tokens: list[str], config: V2Config) -> CanonicalFloorplan:
    return Decoder(tokens, config).decode()
