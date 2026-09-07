"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const ui = {
  title: document.getElementById("building-title"),
  step: document.getElementById("step-value"),
  phase: document.getElementById("phase-value"),
  room: document.getElementById("room-value"),
  summary: document.getElementById("event-summary"),
  svg: document.getElementById("plan-svg"),
  timeline: document.getElementById("timeline"),
  play: document.getElementById("play-button"),
  previous: document.getElementById("prev-button"),
  next: document.getElementById("next-button"),
  speed: document.getElementById("speed"),
  graphTokens: document.getElementById("graph-tokens"),
  eventTokens: document.getElementById("event-tokens"),
  tokenCount: document.getElementById("token-count"),
  fatal: document.getElementById("fatal-error"),
  shell: document.querySelector(".app-shell"),
};

let session;
let frame = 0;
let timer = null;
let roomById;
let wallById;
let openingById;

function svgElement(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function screenPoint(point) {
  return [point.x_mm, -point.y_mm];
}

function robotTransform(state) {
  const [x, y] = screenPoint(state.position);
  const rotation = { NORTH: 0, EAST: 90, SOUTH: 180, WEST: 270 }[state.heading] || 0;
  return `translate(${x} ${y}) rotate(${rotation})`;
}

function playbackState(targetFrame) {
  const events = session.trajectory.events;
  const revealedRooms = new Set();
  const revealedWalls = new Set();
  const revealedOpenings = new Set();
  const trail = [];
  const initial = events[0].state_before;
  trail.push(initial.position);
  for (let index = 0; index < targetFrame; index += 1) {
    const event = events[index];
    const observation = event.observation;
    if (observation?.type === "ENTER_NEW_ROOM" && observation.data.source_room_id) {
      revealedRooms.add(observation.data.source_room_id);
    }
    for (const wall of observation?.wall_segments || []) {
      revealedWalls.add(wall.id);
      for (const opening of wall.openings) revealedOpenings.add(opening.id);
    }
    const point = event.state_after.position;
    const previous = trail[trail.length - 1];
    if (point.x_mm !== previous.x_mm || point.y_mm !== previous.y_mm) trail.push(point);
  }
  return {
    revealedRooms,
    revealedWalls,
    revealedOpenings,
    trail,
    robot: targetFrame ? events[targetFrame - 1].state_after : initial,
  };
}

function openingSegment(opening) {
  const direction = Object.values(opening.global_directions)[0];
  const half = opening.width_mm / 2;
  if (direction === "NORTH" || direction === "SOUTH") {
    return [opening.center.x_mm - half, -opening.center.y_mm, opening.center.x_mm + half, -opening.center.y_mm];
  }
  return [opening.center.x_mm, -opening.center.y_mm - half, opening.center.x_mm, -opening.center.y_mm + half];
}

function renderPlan(state, previousRobot, animate) {
  const bounds = session.scene.bounds;
  const width = Math.max(1, bounds.max_x_mm - bounds.min_x_mm);
  const height = Math.max(1, bounds.max_y_mm - bounds.min_y_mm);
  const padding = Math.max(600, Math.round(Math.max(width, height) * 0.08));
  ui.svg.setAttribute("viewBox", `${bounds.min_x_mm - padding} ${-bounds.max_y_mm - padding} ${width + padding * 2} ${height + padding * 2}`);
  ui.svg.replaceChildren();

  const roomLayer = svgElement("g");
  for (const roomId of state.revealedRooms) {
    const room = roomById.get(roomId);
    if (!room) continue;
    const points = room.polygon.map((point) => screenPoint(point).join(",")).join(" ");
    roomLayer.append(svgElement("polygon", { points, class: "room-fill" }));
    const label = svgElement("text", {
      x: (room.bounds.min_x_mm + room.bounds.max_x_mm) / 2,
      y: -(room.bounds.min_y_mm + room.bounds.max_y_mm) / 2,
      class: "room-label",
    });
    label.textContent = room.display_name || room.function;
    roomLayer.append(label);
  }
  ui.svg.append(roomLayer);

  if (state.trail.length > 1) {
    ui.svg.append(svgElement("polyline", {
      points: state.trail.map((point) => screenPoint(point).join(",")).join(" "),
      class: "trail-line",
    }));
  }

  const wallLayer = svgElement("g");
  for (const wallId of state.revealedWalls) {
    const wall = wallById.get(wallId);
    if (!wall) continue;
    const [x1, y1] = screenPoint(wall.segment.start);
    const [x2, y2] = screenPoint(wall.segment.end);
    wallLayer.append(svgElement("line", { x1, y1, x2, y2, class: "wall-line" }));
  }
  ui.svg.append(wallLayer);

  const openingLayer = svgElement("g");
  for (const openingId of state.revealedOpenings) {
    const opening = openingById.get(openingId);
    if (!opening) continue;
    const [x1, y1, x2, y2] = openingSegment(opening);
    openingLayer.append(svgElement("line", { x1, y1, x2, y2, class: "opening-mask" }));
    const kind = opening.opening_type === "WINDOW" ? "window" : opening.opening_type === "OPEN_PASSAGE" ? "passage" : "door";
    openingLayer.append(svgElement("line", { x1, y1, x2, y2, class: `opening-line opening-${kind}` }));
  }
  ui.svg.append(openingLayer);

  const robot = svgElement("g", { class: "robot-marker" });
  robot.append(svgElement("path", { d: "M 0 -180 L 125 125 L 0 82 L -125 125 Z", class: "robot-body" }));
  robot.append(svgElement("circle", { cx: 0, cy: 18, r: 38, class: "robot-core" }));
  robot.setAttribute("transform", animate && previousRobot ? robotTransform(previousRobot) : robotTransform(state.robot));
  ui.svg.append(robot);
  if (animate && previousRobot) requestAnimationFrame(() => robot.setAttribute("transform", robotTransform(state.robot)));
}

function tokenChip(token) {
  const chip = document.createElement("code");
  chip.className = "token";
  chip.textContent = token;
  return chip;
}

function renderGraphTokens() {
  const [start, end] = session.graph_token_range;
  const fragment = document.createDocumentFragment();
  for (const token of session.tokens.tokens.slice(start, end)) fragment.append(tokenChip(token));
  ui.graphTokens.replaceChildren(fragment);
}

function renderEventTokens(targetFrame) {
  if (targetFrame === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "播放探索以生成 Token";
    ui.eventTokens.replaceChildren(empty);
    ui.tokenCount.textContent = "0";
    return;
  }
  const fragment = document.createDocumentFragment();
  let count = 0;
  for (let index = 0; index < targetFrame; index += 1) {
    const span = session.event_token_spans[index];
    const group = document.createElement("div");
    group.className = `event-group${index === targetFrame - 1 ? " current" : ""}`;
    const step = document.createElement("span");
    step.className = "event-step";
    step.textContent = `EVENT ${span.step}`;
    group.append(step);
    for (const token of session.tokens.tokens.slice(span.start, span.end)) {
      group.append(tokenChip(token));
      count += 1;
    }
    fragment.append(group);
  }
  ui.eventTokens.replaceChildren(fragment);
  ui.tokenCount.textContent = String(count);
  ui.eventTokens.querySelector(".current")?.scrollIntoView({ block: "nearest" });
}

function updateStatus(targetFrame, state) {
  const total = session.trajectory.events.length;
  const event = targetFrame ? session.trajectory.events[targetFrame - 1] : null;
  ui.step.textContent = `${targetFrame} / ${total}`;
  ui.phase.textContent = state.robot.phase;
  ui.room.textContent = state.robot.current_room_id || "室外";
  const action = event?.action?.type || "—";
  const observation = event?.observation?.type || "—";
  ui.summary.textContent = event ? `${action}  ·  ${observation}` : "等待开始";
  ui.timeline.value = String(targetFrame);
  ui.previous.disabled = targetFrame === 0;
  ui.next.disabled = targetFrame === total;
  ui.play.textContent = timer ? "暂停" : targetFrame === total ? "重播" : "播放";
}

function setFrame(nextFrame, animate = false) {
  const target = Math.max(0, Math.min(session.trajectory.events.length, nextFrame));
  const previousState = playbackState(frame);
  frame = target;
  const state = playbackState(frame);
  renderPlan(state, previousState.robot, animate && Math.abs(target - Number(ui.timeline.value)) === 1);
  renderEventTokens(frame);
  updateStatus(frame, state);
}

function stopPlayback() {
  if (timer) window.clearInterval(timer);
  timer = null;
  if (session) updateStatus(frame, playbackState(frame));
}

function startPlayback() {
  stopPlayback();
  if (frame === session.trajectory.events.length) setFrame(0);
  const interval = 800 / Number(ui.speed.value);
  timer = window.setInterval(() => {
    if (frame >= session.trajectory.events.length) {
      stopPlayback();
      return;
    }
    setFrame(frame + 1, true);
  }, interval);
  updateStatus(frame, playbackState(frame));
}

function bindControls() {
  ui.play.addEventListener("click", () => timer ? stopPlayback() : startPlayback());
  ui.previous.addEventListener("click", () => { stopPlayback(); setFrame(frame - 1); });
  ui.next.addEventListener("click", () => { stopPlayback(); setFrame(frame + 1, true); });
  ui.timeline.addEventListener("input", () => { stopPlayback(); setFrame(Number(ui.timeline.value)); });
  ui.speed.addEventListener("change", () => { if (timer) startPlayback(); });
  document.addEventListener("keydown", (event) => {
    if (["INPUT", "SELECT", "BUTTON"].includes(document.activeElement?.tagName)) return;
    if (event.key === " ") { event.preventDefault(); timer ? stopPlayback() : startPlayback(); }
    if (event.key === "ArrowLeft") { stopPlayback(); setFrame(frame - 1); }
    if (event.key === "ArrowRight") { stopPlayback(); setFrame(frame + 1, true); }
  });
}

async function initialize() {
  try {
    const response = await fetch("/api/session");
    if (!response.ok) throw new Error(`会话加载失败：HTTP ${response.status}`);
    session = await response.json();
    roomById = new Map(session.scene.rooms.map((room) => [room.id, room]));
    wallById = new Map(session.scene.wall_segments.map((wall) => [wall.id, wall]));
    openingById = new Map(session.scene.openings.map((opening) => [opening.id, opening]));
    ui.title.textContent = session.scene.building_id;
    ui.timeline.max = String(session.trajectory.events.length);
    renderGraphTokens();
    bindControls();
    setFrame(0);
  } catch (error) {
    ui.shell.hidden = true;
    ui.fatal.hidden = false;
    ui.fatal.textContent = error instanceof Error ? error.message : String(error);
  }
}

initialize();
