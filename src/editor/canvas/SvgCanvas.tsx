import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  createIdleWallCommand,
  reduceWallCommand,
  WallTopologyTransactionError,
  type WallCommandContext,
  type WallCommandState,
} from '@/editor/commands/wallCommand.ts';
import type {
  BuildingDocument,
  BuildingVertex,
  ReferenceImage,
} from '@/editor/domain/buildingTypes.ts';
import {
  referenceLocalToWorld,
  scaleReferenceAround,
  translateReference,
  type ReferencePoint,
} from '@/editor/reference-image/referenceTransform.ts';
import {
  fitWorldPoints,
  panBy,
  screenToWorld,
  zoomAt,
  type CanvasSize,
} from './Viewport.ts';
import { useEditorStore } from '@/editor/store/editorStore.ts';
import { WallLayer } from './layers/WallLayer.tsx';
import { OverlayLayer } from './layers/OverlayLayer.tsx';
import {
  ReferenceImageLayer,
  type ReferenceCorner,
} from './layers/ReferenceImageLayer.tsx';
import { FaceLayer } from './layers/FaceLayer.tsx';
import { WallElementLayer } from './layers/WallElementLayer.tsx';
import { VertexLayer } from './layers/VertexLayer.tsx';
import {
  placeWallElement,
  updateWallElement,
} from '@/editor/commands/wallElementCommand.ts';
import { moveVertex } from '@/editor/commands/pointMoveCommand.ts';
import { deleteEntity } from '@/editor/commands/deleteEntityCommand.ts';
import type { WallElementType } from '@/editor/domain/buildingTypes.ts';
import { CommandBar } from '@/editor/panels/CommandBar.tsx';
import {
  createSnapIndex,
  findSnap,
  type SnapResult,
} from '@/editor/cad/snapEngine.ts';
import styles from './SvgCanvas.module.css';
import { ROOM_FUNCTION_DICTIONARY } from '@/editor/domain/constants.ts';
import { resolveWallElementPlacement } from '@/editor/domain/wallElementPlacement.ts';
import {
  CORE_ROOM_FUNCTION_PRESETS,
  mergeRoomFunctionTypes,
} from '@/editor/domain/roomFunctionTemplates.ts';

const DEFAULT_SIZE: CanvasSize = { width: 800, height: 600 };

interface SvgCanvasProps {
  handleHistoryShortcuts?: boolean;
  autoFitReference?: boolean;
}

export function SvgCanvas({
  handleHistoryShortcuts = true,
  autoFitReference = true,
}: SvgCanvasProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [sizeReady, setSizeReady] = useState(false);
  const [command, setCommand] = useState<WallCommandState>(
    createIdleWallCommand,
  );
  const [commandError, setCommandError] = useState<string | null>(null);
  const [currentSnap, setCurrentSnap] = useState<SnapResult>({
    kind: 'none',
  });
  const [referencePreview, setReferencePreview] =
    useState<ReferenceImage | null>(null);
  const panState = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const spacePressed = useRef(false);
  const spaceGesture = useRef({
    downAt: 0,
    lastTapAt: 0,
    usedForPan: false,
  });
  const altPressed = useRef(false);
  const fittedReferenceKey = useRef<string | null>(null);
  const expectedInternalDocument = useRef<BuildingDocument | null>(null);
  const referenceDrag = useRef<ReferenceDragState | null>(null);
  const vertexDrag = useRef<{
    pointerId: number;
    vertexId: string;
    originalPoint: BuildingVertex;
    currentPoint: BuildingVertex;
  } | null>(null);
  const commitCommandRef = useRef<(current: WallCommandState) => void>(
    () => undefined,
  );
  const duplicateLastWallRef = useRef<() => void>(() => undefined);
  const [vertexDragPreview, setVertexDragPreview] =
    useState<BuildingVertex | null>(null);

  const document = useEditorStore((state) => state.buildingDocument);
  const tool = useEditorStore((state) => state.tool);
  const brushFunctionCode = useEditorStore((state) => state.brushFunctionCode);
  const selection = useEditorStore((state) => state.selection);
  const snapMode = useEditorStore((state) => state.snapMode);
  const directionMode = useEditorStore((state) => state.directionMode);
  const viewport = useEditorStore((state) => state.viewport);
  const setViewport = useEditorStore((state) => state.setViewport);
  const setSelection = useEditorStore((state) => state.setSelection);
  const transact = useEditorStore((state) => state.transact);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const snapIndex = useMemo(
    () => (document ? createSnapIndex(document) : null),
    [document],
  );

  useEffect(() => {
    const updateSize = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      setSize({
        width: rect?.width || DEFAULT_SIZE.width,
        height: rect?.height || DEFAULT_SIZE.height,
      });
      setSizeReady(true);
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  useEffect(() => {
    if (!autoFitReference || !document || !sizeReady) return;
    const image = document.reference_image;
    if (!image.path || image.width_px <= 0 || image.height_px <= 0) return;
    const key = `${document.building_id}:${image.path}:${image.width_px}x${image.height_px}`;
    if (fittedReferenceKey.current === key) return;
    const corners = [
      { x: 0, y: 0 },
      { x: image.width_px, y: 0 },
      { x: image.width_px, y: image.height_px },
      { x: 0, y: image.height_px },
    ].map((point) => {
      const world = referenceLocalToWorld(image.transform, point);
      return { x_mm: world.x, y_mm: world.y };
    });
    setViewport(fitWorldPoints(corners, size, 0.8));
    fittedReferenceKey.current = key;
  }, [autoFitReference, document, setViewport, size, sizeReady]);

  useEffect(() => {
    setCommand(createIdleWallCommand());
    setCommandError(null);
    expectedInternalDocument.current = null;
    panState.current = null;
    referenceDrag.current = null;
    vertexDrag.current = null;
    setReferencePreview(null);
    setVertexDragPreview(null);
  }, [tool]);

  useEffect(() => {
    setCurrentSnap({ kind: 'none' });
  }, [document, snapMode, tool]);

  useEffect(() => {
    setCommand((current) =>
      document &&
      expectedInternalDocument.current === document
        ? current
        : createIdleWallCommand(),
    );
  }, [document]);

  const worldTransform = useMemo(
    () =>
      `translate(${-viewport.originXmm * viewport.pixelsPerMm} ${
        size.height + viewport.originYmm * viewport.pixelsPerMm
      }) scale(${viewport.pixelsPerMm} ${-viewport.pixelsPerMm})`,
    [size.height, viewport],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      ) {
        return;
      }
      if (event.code === 'Space') {
        if (!event.repeat && !spacePressed.current) {
          spaceGesture.current.downAt = Date.now();
          spaceGesture.current.usedForPan = false;
        }
        spacePressed.current = true;
        event.preventDefault();
        return;
      }
      if (event.key === 'Alt') {
        altPressed.current = true;
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const state = useEditorStore.getState();
        const sel = state.selection;
        const currentDoc = state.buildingDocument;

        // 如果在墙体绘制中，Backspace 删除最后输入字符
        if (event.key === 'Backspace' && command.phase === 'drawing') {
          event.preventDefault();
          setCommand((current) =>
            current.phase === 'drawing'
              ? { ...current, input: current.input.slice(0, -1) }
              : current,
          );
          return;
        }

        // v2.1.0: 删除当前选中的实体（顶点/墙体/构件/面/室外区域）
        if (sel && currentDoc) {
          event.preventDefault();
          const entityType = sel.type;
          const entityId = sel.id;
          const entityLabels: Record<string, string> = {
            vertex: '顶点',
            wall: '墙体',
            wall_element: '构件',
            face: '房间面',
            outside_region: '室外区域',
          };
          const label = entityLabels[entityType] ?? entityType;

          // 删除前确认（仅对墙体、面、构件需要确认，顶点直接删除）
          const needsConfirm =
            entityType === 'wall' ||
            entityType === 'wall_element' ||
            entityType === 'face' ||
            entityType === 'outside_region';

          if (
            needsConfirm &&
            !confirm(`确认删除此${label}？\n\n该操作会同时清理关联数据，可以通过撤销恢复。`)
          ) {
            return;
          }

          const result = deleteEntity(currentDoc, entityType, entityId);
          if (result.ok) {
            transact(`删除${label} ${entityId}`, () => result.document);
            setSelection(null);
            setCommandError(null);
          } else {
            setCommandError(result.message);
          }
          return;
        }

        if (event.key === 'Delete') return;
      }
      if (
        handleHistoryShortcuts &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'z'
      ) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (
        handleHistoryShortcuts &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'y'
      ) {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key === 'Escape') {
        if (vertexDrag.current) {
          vertexDrag.current = null;
          setVertexDragPreview(null);
          return;
        }
      }
      if (!isWallTool(tool)) return;
      if (event.key === 'Escape') {
        setCommand(
          reduceWallCommand(
            command,
            { type: 'CANCEL' },
            makeContext(document, tool),
          ).state,
        );
        setCommandError(null);
        return;
      }
      if (event.key === 'Backspace' && command.phase === 'drawing') {
        event.preventDefault();
        setCommand((current) =>
          current.phase === 'drawing'
            ? {
                ...current,
                input: current.input.slice(0, -1),
              }
            : current,
        );
        return;
      }
      if (/^[0-9.,]$/.test(event.key) && command.phase === 'drawing') {
        event.preventDefault();
        setCommand((current) =>
          reduceWallCommand(
            current,
            {
              type: 'INPUT',
              value:
                current.phase === 'drawing'
                  ? `${current.input}${event.key}`
                  : event.key,
            },
            makeContext(document, tool),
          ).state,
        );
        setCommandError(null);
        return;
      }
      if (event.key === 'Enter' && command.phase === 'drawing') {
        event.preventDefault();
        commitCommandRef.current(command);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        const now = Date.now();
        const isTap =
          spacePressed.current &&
          !spaceGesture.current.usedForPan &&
          now - spaceGesture.current.downAt <= 300;
        spacePressed.current = false;
        if (isTap) {
          if (
            spaceGesture.current.lastTapAt > 0 &&
            now - spaceGesture.current.lastTapAt <= 400
          ) {
            spaceGesture.current.lastTapAt = 0;
            duplicateLastWallRef.current();
          } else {
            spaceGesture.current.lastTapAt = now;
          }
        } else {
          spaceGesture.current.lastTapAt = 0;
        }
      }
      if (event.key === 'Alt') altPressed.current = false;
    };
    const handleWindowBlur = () => {
      spacePressed.current = false;
      spaceGesture.current = {
        downAt: 0,
        lastTapAt: 0,
        usedForPan: false,
      };
      altPressed.current = false;
      expectedInternalDocument.current = null;
      panState.current = null;
      referenceDrag.current = null;
      vertexDrag.current = null;
      setReferencePreview(null);
      setVertexDragPreview(null);
      setCurrentSnap({ kind: 'none' });
      setCommand(createIdleWallCommand());
      setCommandError(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [
    command,
    document,
    handleHistoryShortcuts,
    redo,
    setSelection,
    tool,
    transact,
    undo,
  ]);

  if (!document) {
    return <div className={styles.container}>未加载建筑文档</div>;
  }

  const eventWorldPoint = (
    event: Pick<PointerEvent, 'clientX' | 'clientY'>,
  ): BuildingVertex => {
    const rect = containerRef.current?.getBoundingClientRect();
    return screenToWorld(
      {
        x: event.clientX - (rect?.left ?? 0),
        y: event.clientY - (rect?.top ?? 0),
      },
      viewport,
      size,
    );
  };

  const snapPoint = (
    point: BuildingVertex,
    excludeVertexIds?: Set<string>,
  ): {
    point: BuildingVertex;
    vertexId?: string;
    snap: SnapResult;
  } => {
    const snap = findSnap(
      snapIndex!,
      point,
      viewport.pixelsPerMm,
      snapMode,
      12,
      excludeVertexIds,
    );
    setCurrentSnap(snap);
    if (snap.kind === 'none') {
      return {
        point: {
          x_mm: Math.round(point.x_mm),
          y_mm: Math.round(point.y_mm),
        },
        snap,
      };
    }
    return snap.kind === 'vertex'
      ? { point: snap.point, vertexId: snap.vertexId, snap }
      : { point: snap.point, snap };
  };

  const applyWallCommandResult = (
    current: WallCommandState,
    result: ReturnType<typeof reduceWallCommand>,
  ) => {
    if (result.transaction) {
      let appliedDocument: BuildingDocument | undefined;
      try {
        transact(result.transaction.description, (currentDocument) => {
          const nextDocument =
            result.transaction!.apply(currentDocument);
          appliedDocument = nextDocument;
          expectedInternalDocument.current = nextDocument;
          return nextDocument;
        });
      } catch (error) {
        expectedInternalDocument.current = null;
        setCommand({ ...current });
        setCommandError(
          error instanceof WallTopologyTransactionError
            ? error.message
            : '拓扑插入失败：无法提交墙体',
        );
        return;
      }
      if (appliedDocument) {
        setCommand(
          result.transaction.stateAfter(appliedDocument),
        );
      }
      setCommandError(null);
      return;
    }
    setCommand(result.state);
    setCommandError(result.error);
  };

  const wallElementPlacementAt = (
    point: BuildingVertex,
    elementType: WallElementType,
  ) => {
    const projected = nearestWallProjection(
      document,
      point,
      14 / viewport.pixelsPerMm,
    );
    if (!projected) return null;
    const wall = document.walls[projected.wallId];
    const start = wall && document.vertices[wall.start_vertex_id];
    const end = wall && document.vertices[wall.end_vertex_id];
    if (!start || !end) return null;
    const length = Math.hypot(end.x_mm - start.x_mm, end.y_mm - start.y_mm);
    const defaults = WALL_ELEMENT_DEFAULTS[elementType];
    const placement = resolveWallElementPlacement(
      length,
      defaults.width_mm,
      projected.offsetMm,
      14 / viewport.pixelsPerMm,
    );
    const ux = (end.x_mm - start.x_mm) / length;
    const uy = (end.y_mm - start.y_mm) / length;
    return {
      wallId: projected.wallId,
      defaults,
      placement,
      point: {
        x_mm: Math.round(start.x_mm + ux * placement.centerOffsetMm),
        y_mm: Math.round(start.y_mm + uy * placement.centerOffsetMm),
      },
    };
  };
  const commitCommand = (current: WallCommandState) => {
    const latestDocument =
      useEditorStore.getState().buildingDocument;
    applyWallCommandResult(
      current,
      reduceWallCommand(
        current,
        { type: 'CONFIRM' },
        makeContext(latestDocument, tool),
      ),
    );
  };
  commitCommandRef.current = commitCommand;
  duplicateLastWallRef.current = () => {
    if (tool !== 'exterior_wall' || command.phase !== 'idle') return;
    const latestDocument = useEditorStore.getState().buildingDocument;
    applyWallCommandResult(
      command,
      reduceWallCommand(
        command,
        { type: 'DUPLICATE_LAST' },
        makeContext(latestDocument, tool),
      ),
    );
  };

  const handleStartVertexDrag = (
    vertexId: string,
    pointerId: number,
  ) => {
    const vertex = document.vertices[vertexId];
    if (!vertex) return;
    vertexDrag.current = {
      pointerId,
      vertexId,
      originalPoint: { ...vertex },
      currentPoint: { ...vertex },
    };
    setVertexDragPreview({ ...vertex });
    // Capture pointer on the container so we receive move/up events
    // even when the cursor leaves the vertex hit circle.
    const svg = containerRef.current?.querySelector('svg');
    if (svg) svg.setPointerCapture(pointerId);
  };

  const handleStartReferenceScale = (
    corner: ReferenceCorner,
    pointerId: number,
    event: ReactPointerEvent<SVGRectElement>,
  ) => {
    const image = document.reference_image;
    const width = image.width_px;
    const height = image.height_px;
    const anchors: Record<ReferenceCorner, ReferencePoint> = {
      tl: { x: width, y: height },
      tr: { x: 0, y: height },
      bl: { x: width, y: 0 },
      br: { x: 0, y: 0 },
    };
    const corners: Record<ReferenceCorner, ReferencePoint> = {
      tl: { x: 0, y: 0 },
      tr: { x: width, y: 0 },
      bl: { x: 0, y: height },
      br: { x: width, y: height },
    };
    const anchorLocal = anchors[corner];
    referenceDrag.current = {
      mode: 'scale',
      pointerId,
      latest: eventWorldPoint(event.nativeEvent),
      original: image,
      anchorLocal,
      anchorWorld: referenceLocalToWorld(image.transform, anchorLocal),
      cornerWorld: referenceLocalToWorld(image.transform, corners[corner]),
    };
    const svg = containerRef.current?.querySelector('svg');
    svg?.setPointerCapture?.(pointerId);
  };

  const handlePointerDown = (
    event: ReactPointerEvent<SVGSVGElement>,
  ) => {
    if (event.button === 1 || spacePressed.current) {
      if (spacePressed.current) spaceGesture.current.usedForPan = true;
      panState.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
    if (!isWallTool(tool)) {
      if (isWallElementTool(tool)) {
        const resolved = wallElementPlacementAt(
          eventWorldPoint(event.nativeEvent),
          tool,
        );
        if (!resolved) {
          setCommandError('请在墙体上放置构件。');
          return;
        }
        const placement = placeWallElement(document, {
          element_type: tool,
          host_wall_id: resolved.wallId,
          center_offset_mm: resolved.placement.centerOffsetMm,
          ...resolved.defaults,
        });
        if (!placement.ok) {
          setCommandError(placement.message);
          return;
        }
        transact(`Place ${tool}`, () => placement.document);
        if (resolved.placement.fraction) {
          setCurrentSnap({
            kind: 'wall_fraction',
            point: resolved.point,
            wallId: resolved.wallId,
            fraction: resolved.placement.fraction,
          });
        }
        setCommandError(null);
        return;
      }
      if (tool === 'adjust_reference') {
        const point = eventWorldPoint(event.nativeEvent);
        referenceDrag.current = {
          mode: 'translate',
          pointerId: event.pointerId,
          start: point,
          latest: point,
          original: document.reference_image,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        return;
      }
      if (tool === 'select') setSelection(null);
      return;
    }

    const snapped = snapPoint(eventWorldPoint(event.nativeEvent));
    if (command.phase === 'idle') {
      setCommand(
        reduceWallCommand(
          command,
          {
            type: 'START',
            point: snapped.point,
            vertexId: snapped.vertexId,
          },
          makeContext(document, tool),
        ).state,
      );
      setCommandError(null);
      return;
    }

    const moved = reduceWallCommand(
      command,
      {
        type: 'MOVE',
        point: snapped.point,
        constraint: constraintForSnap(
          snapped.snap,
          directionMode,
        ),
      },
      makeContext(document, tool),
    ).state;
    commitCommand(moved);
  };

  const handlePointerMove = (
    event: ReactPointerEvent<SVGSVGElement>,
  ) => {
    if (panState.current) {
      const previous = panState.current;
      if (event.pointerId !== previous.pointerId) return;
      const delta = {
        x: event.clientX - previous.x,
        y: event.clientY - previous.y,
      };
      panState.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      setViewport(panBy(viewport, delta));
      return;
    }
    if (vertexDrag.current) {
      if (event.pointerId !== vertexDrag.current.pointerId) return;
      const worldPoint = eventWorldPoint(event.nativeEvent);
      const exclude = new Set([vertexDrag.current.vertexId]);
      const snapped = snapPoint(worldPoint, exclude);
      vertexDrag.current.currentPoint = snapped.point;
      setVertexDragPreview(snapped.point);
      return;
    }
    if (referenceDrag.current && tool === 'adjust_reference') {
      if (event.pointerId !== referenceDrag.current.pointerId) return;
      const point = eventWorldPoint(event.nativeEvent);
      const drag = referenceDrag.current;
      drag.latest = point;
      setReferencePreview(
        drag.mode === 'scale'
          ? scalePreviewFromDrag(drag)
          : translateReference(
              drag.original,
              point.x_mm - drag.start.x_mm,
              point.y_mm - drag.start.y_mm,
            ),
      );
      return;
    }
    if (isWallElementTool(tool)) {
      const resolved = wallElementPlacementAt(
        eventWorldPoint(event.nativeEvent),
        tool,
      );
      if (!resolved) {
        setCurrentSnap({ kind: 'none' });
        return;
      }
      setCurrentSnap(
        resolved.placement.fraction
          ? {
              kind: 'wall_fraction',
              point: resolved.point,
              wallId: resolved.wallId,
              fraction: resolved.placement.fraction,
            }
          : {
              kind: 'wall_projection',
              point: resolved.point,
              wallId: resolved.wallId,
            },
      );
      return;
    }
    if (!isWallTool(tool)) return;
    const snapped = snapPoint(eventWorldPoint(event.nativeEvent));
    let activeCommand = command;
    if (activeCommand.phase !== 'drawing' && altPressed.current) {
      activeCommand = reduceWallCommand(
        activeCommand,
        { type: 'ACTIVATE_CONTINUATION' },
        makeContext(document, tool),
      ).state;
    }
    if (activeCommand.phase !== 'drawing') return;
    const result = reduceWallCommand(
      activeCommand,
      {
        type: 'MOVE',
        point: snapped.point,
        constraint: constraintForSnap(
          snapped.snap,
          directionMode,
        ),
      },
      makeContext(document, tool),
    );
    setCommand(result.state);
  };

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    setViewport(
      zoomAt(
        viewport,
        {
          x: event.clientX - (rect?.left ?? 0),
          y: event.clientY - (rect?.top ?? 0),
        },
        event.deltaY < 0 ? 1.15 : 1 / 1.15,
        size,
      ),
    );
  };

  const finishPointerInteraction = (
    event: ReactPointerEvent<SVGSVGElement>,
  ) => {
    if (
      panState.current &&
      event.pointerId !== panState.current.pointerId
    ) {
      return;
    }
    panState.current = null;
    const vertexState = vertexDrag.current;
    if (vertexState && event.pointerId === vertexState.pointerId) {
      vertexDrag.current = null;
      setVertexDragPreview(null);
      const latestDocument =
        useEditorStore.getState().buildingDocument;
      if (
        latestDocument &&
        (vertexState.currentPoint.x_mm !== vertexState.originalPoint.x_mm ||
          vertexState.currentPoint.y_mm !== vertexState.originalPoint.y_mm
        )
      ) {
        const result = moveVertex(
          latestDocument,
          vertexState.vertexId,
          vertexState.currentPoint,
        );
        if (result.ok) {
          transact(`移动顶点 ${vertexState.vertexId}`, () => result.document);
          setSelection({ type: 'vertex', id: result.vertexId });
        }
      }
      return;
    }
    const drag = referenceDrag.current;
    if (drag) {
      if (event.pointerId !== drag.pointerId) return;
      if (drag.mode === 'scale') {
        transact('缩放参考图', (current) => ({
          ...current,
          reference_image: scalePreviewFromDrag(drag),
        }));
      } else {
        const translated = translateReference(
          drag.original,
          drag.latest.x_mm - drag.start.x_mm,
          drag.latest.y_mm - drag.start.y_mm,
        );
        transact('平移参考图', (current) => ({
          ...current,
          reference_image: translated,
        }));
      }
      referenceDrag.current = null;
      setReferencePreview(null);
    }
  };

  return (
    <div ref={containerRef} className={styles.container}>
      <svg
        data-testid="svg-canvas"
        className={`${styles.canvas} ${
          tool === 'select' ? styles.selectCursor : ''
        } ${panState.current ? styles.panCursor : ''}`}
        width={size.width}
        height={size.height}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerInteraction}
        onPointerCancel={finishPointerInteraction}
        onLostPointerCapture={finishPointerInteraction}
        onWheel={handleWheel}
      >
        <g transform={worldTransform}>
          <ReferenceImageLayer
            document={document}
            adjustable={tool === 'adjust_reference'}
            pixelsPerMm={viewport.pixelsPerMm}
            previewImage={referencePreview}
            onStartScale={handleStartReferenceScale}
          />
          <FaceLayer
            document={document}
            pixelsPerMm={viewport.pixelsPerMm}
            selectedFaceId={
              selection?.type === 'face' ? selection.id : null
            }
            selectable={tool === 'select' || tool === 'room_label_brush'}
            shouldConsumePointerDown={(event) =>
              event.button === 0 && !spacePressed.current
            }
            onSelectFace={(faceId) => {
              if (tool === 'select') {
                setSelection({ type: 'face', id: faceId });
              } else if (tool === 'room_label_brush') {
                const functionType = mergeRoomFunctionTypes(
                  CORE_ROOM_FUNCTION_PRESETS,
                  document.custom_function_types,
                ).find((item) => item.code === brushFunctionCode);
                if (!functionType) return;
                const residential = ROOM_FUNCTION_DICTIONARY.find(
                  (item) => item.code === brushFunctionCode,
                )?.residential ?? false;
                transact(`标注房间为 ${functionType.name}`, (current) => ({
                  ...current,
                  faces: {
                    ...current.faces,
                    [faceId]: {
                      ...current.faces[faceId],
                      function_code: functionType.code,
                      display_name: functionType.name,
                      color: functionType.color,
                      heated: residential,
                      occupied: residential,
                    },
                  },
                }));
              }
            }}
          />
          <WallLayer
            document={document}
            pixelsPerMm={viewport.pixelsPerMm}
            selectedWallId={
              selection?.type === 'wall' ? selection.id : null
            }
            selectable={tool === 'select'}
            onSelectWall={(wallId) => {
              if (tool === 'select') {
                setSelection({ type: 'wall', id: wallId });
              }
            }}
          />
          <WallElementLayer
            document={document}
            pixelsPerMm={viewport.pixelsPerMm}
            selectedElementId={
              selection?.type === 'wall_element' ? selection.id : null
            }
            selectable={tool === 'select'}
            shouldConsumePointerDown={(event) =>
              event.button === 0 && !spacePressed.current
            }
            onSelectElement={(elementId) => {
              if (tool === 'select') {
                setSelection({ type: 'wall_element', id: elementId });
              }
            }}
            worldPointFromEvent={(event) => eventWorldPoint(event.nativeEvent)}
            onCommitElementOffset={(elementId, offsetFromStartMm) => {
              if (tool !== 'select') return;
              const currentDocument = useEditorStore.getState().buildingDocument;
              if (!currentDocument) return;
              const result = updateWallElement(currentDocument, elementId, {
                offset_from_start_mm: offsetFromStartMm,
              });
              if (!result.ok) {
                setCommandError(result.message);
                return;
              }
              transact(`Move wall element ${elementId}`, () => result.document);
              setCommandError(null);
            }}
            onSnapChange={setCurrentSnap}
          />
          <VertexLayer
            document={document}
            pixelsPerMm={viewport.pixelsPerMm}
            selectedVertexId={
              selection?.type === 'vertex' ? selection.id : null
            }
            selectable={tool === 'select'}
            onSelectVertex={(vertexId) => {
              if (tool === 'select') {
                setSelection({ type: 'vertex', id: vertexId });
              }
            }}
            onStartDrag={handleStartVertexDrag}
          />
          <OverlayLayer
            command={command}
            pixelsPerMm={viewport.pixelsPerMm}
            snap={currentSnap}
            vertexDragPreview={vertexDragPreview}
          />
        </g>
      </svg>
      <CommandBar
        tool={tool}
        command={command}
        error={commandError}
        snap={currentSnap}
      />
    </div>
  );
}

type ReferenceDragState =
  | {
      mode: 'translate';
      pointerId: number;
      start: BuildingVertex;
      latest: BuildingVertex;
      original: ReferenceImage;
    }
  | {
      mode: 'scale';
      pointerId: number;
      latest: BuildingVertex;
      original: ReferenceImage;
      anchorLocal: ReferencePoint;
      anchorWorld: ReferencePoint;
      cornerWorld: ReferencePoint;
    };

/** 根据拖拽终点计算缩放后的参考图：锚点钉住不动，角点跟随指针在锚点连线上的投影 */
function scalePreviewFromDrag(
  drag: Extract<ReferenceDragState, { mode: 'scale' }>,
): ReferenceImage {
  const { latest, original, anchorLocal, anchorWorld, cornerWorld } = drag;
  const dx = cornerWorld.x - anchorWorld.x;
  const dy = cornerWorld.y - anchorWorld.y;
  const denom = dx * dx + dy * dy;
  const factor =
    denom > 0
      ? ((latest.x_mm - anchorWorld.x) * dx +
          (latest.y_mm - anchorWorld.y) * dy) /
        denom
      : 1;
  return scaleReferenceAround(
    original,
    original.transform.scale * factor,
    anchorLocal,
  );
}

const WALL_ELEMENT_DEFAULTS: Record<
  WallElementType,
  { width_mm: number; height_mm: number; sill_height_mm: number }
> = {
  exterior_door: { width_mm: 1000, height_mm: 2100, sill_height_mm: 0 },
  exterior_window: { width_mm: 1300, height_mm: 1200, sill_height_mm: 900 },
  interior_door: { width_mm: 1000, height_mm: 2100, sill_height_mm: 0 },
  passage: { width_mm: 1000, height_mm: 2100, sill_height_mm: 0 },
};

function isWallElementTool(
  tool: ReturnType<typeof useEditorStore.getState>['tool'],
): tool is WallElementType {
  return (
    tool === 'exterior_door' ||
    tool === 'exterior_window' ||
    tool === 'interior_door' ||
    tool === 'passage'
  );
}

function nearestWallProjection(
  document: BuildingDocument,
  point: BuildingVertex,
  maximumDistanceMm: number,
): { wallId: string; offsetMm: number } | null {
  let nearest: { wallId: string; offsetMm: number; distanceMm: number } | null =
    null;
  for (const [wallId, wall] of Object.entries(document.walls)) {
    const start = document.vertices[wall.start_vertex_id];
    const end = document.vertices[wall.end_vertex_id];
    if (!start || !end) continue;
    const dx = end.x_mm - start.x_mm;
    const dy = end.y_mm - start.y_mm;
    const lengthSquared = dx * dx + dy * dy;
    if (!Number.isFinite(lengthSquared) || lengthSquared <= 0) continue;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point.x_mm - start.x_mm) * dx + (point.y_mm - start.y_mm) * dy) /
          lengthSquared,
      ),
    );
    const projectedX = start.x_mm + t * dx;
    const projectedY = start.y_mm + t * dy;
    const distanceMm = Math.hypot(point.x_mm - projectedX, point.y_mm - projectedY);
    if (
      distanceMm <= maximumDistanceMm &&
      (!nearest || distanceMm < nearest.distanceMm)
    ) {
      nearest = {
        wallId,
        offsetMm: t * Math.sqrt(lengthSquared),
        distanceMm,
      };
    }
  }
  return nearest && { wallId: nearest.wallId, offsetMm: nearest.offsetMm };
}

function isWallTool(
  tool: ReturnType<typeof useEditorStore.getState>['tool'],
): boolean {
  return (
    tool === 'exterior_wall' ||
    tool === 'interior_wall' ||
    tool === 'polyline_wall'
  );
}

function constraintForSnap(
  snap: SnapResult,
  directionMode: ReturnType<
    typeof useEditorStore.getState
  >['directionMode'],
) {
  return snap.kind === 'none' || snap.kind === 'grid'
    ? directionMode === 'diagonal45'
      ? 'forty_five'
      : directionMode
    : 'free';
}

function makeContext(
  document: BuildingDocument | null,
  tool: ReturnType<typeof useEditorStore.getState>['tool'],
): WallCommandContext {
  const ids = createIdFactory(document);
  return {
    document,
    wallType: tool === 'exterior_wall' ? 'exterior' : 'interior',
    polyline: tool === 'polyline_wall',
    wallThicknessMm:
      document?.building_defaults.wall_thickness_mm ?? 240,
    wallHeightMm: document?.building_defaults.wall_height_mm ?? 3000,
    materialType: 'brick',
    nextId: ids,
  };
}

function createIdFactory(
  document: BuildingDocument | null,
): WallCommandContext['nextId'] {
  let vertexCounter = maxId(Object.keys(document?.vertices ?? {}), 'v');
  let wallCounter = maxId(Object.keys(document?.walls ?? {}), 'w');
  return (kind) =>
    kind === 'vertex'
      ? `v_${++vertexCounter}`
      : `w_${++wallCounter}`;
}

function maxId(ids: string[], prefix: string): number {
  return ids.reduce((maximum, id) => {
    const match = new RegExp(`^${prefix}_(\\d+)$`).exec(id);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
}
