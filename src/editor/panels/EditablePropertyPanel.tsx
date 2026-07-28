import { useState } from 'react';
import { useEditorStore } from '@/editor/store/editorStore.ts';
import { parseMeters } from '@/editor/domain/cadInput.ts';
import {
  updateWallLength,
  type WallLengthAnchor,
} from '@/editor/domain/wallEditing.ts';
import {
  rotateReference,
  scaleReference,
  setReferenceOpacity,
  translateReference,
} from '@/editor/reference-image/referenceTransform.ts';
import styles from './EditablePropertyPanel.module.css';
import { FaceFunctionPanel } from './FaceFunctionPanel.tsx';
import { ConnectivityPanel } from './ConnectivityPanel.tsx';
import { VertexPropertyPanel } from './VertexPropertyPanel.tsx';

export function EditablePropertyPanel() {
  const document = useEditorStore((state) => state.buildingDocument);
  const selection = useEditorStore((state) => state.selection);
  const tool = useEditorStore((state) => state.tool);

  if (!document) return null;
  if (tool === 'adjust_reference') {
    return <ReferenceProperties />;
  }
  if (selection?.type === 'wall' && document.walls[selection.id]) {
    return <WallProperties key={selection.id} wallId={selection.id} />;
  }
  if (selection?.type === 'face' && document.faces[selection.id]) {
    return <FaceFunctionPanel key={selection.id} faceId={selection.id} />;
  }
  if (selection?.type === 'wall_element' && document.wall_elements[selection.id]) {
    return <ConnectivityPanel key={selection.id} elementId={selection.id} />;
  }
  if (selection?.type === 'vertex' && document.vertices[selection.id]) {
    return <VertexPropertyPanel key={selection.id} vertexId={selection.id} />;
  }
  return (
    <aside className={styles.panel}>
      <div className={styles.header}>属性</div>
      <div className={styles.empty}>
        选择墙体以编辑精确尺寸，或选择“调整参考图”修改草图显示。
      </div>
    </aside>
  );
}

function WallProperties({ wallId }: { wallId: string }) {
  const document = useEditorStore((state) => state.buildingDocument)!;
  const transact = useEditorStore((state) => state.transact);
  const wall = document.walls[wallId];
  const start = document.vertices[wall.start_vertex_id];
  const end = document.vertices[wall.end_vertex_id];
  const initialLength = (
    Math.hypot(end.x_mm - start.x_mm, end.y_mm - start.y_mm) / 1000
  ).toFixed(3);
  const [fixedAnchor, setFixedAnchor] =
    useState<WallLengthAnchor>('start');
  const [length, setLength] = useState(initialLength);
  const [thickness, setThickness] = useState(
    (wall.thickness_mm / 1000).toFixed(3),
  );
  const [height, setHeight] = useState(
    (wall.height_mm / 1000).toFixed(3),
  );
  const [error, setError] = useState('');

  const commitLength = () => {
    const parsed = parseMeters(length, 100);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    transact('修改墙长', (current) =>
      updateWallLength(current, wallId, parsed.millimeters, fixedAnchor),
    );
    setLength(parsed.normalized);
    setError('');
  };

  const commitDimension = (
    label: string,
    value: string,
    property: 'thickness_mm' | 'height_mm',
    setValue: (next: string) => void,
  ) => {
    const parsed = parseMeters(value);
    if (!parsed.ok) {
      setError(`${label}必须大于 0`);
      return;
    }
    transact(`修改${label}`, (current) => ({
      ...current,
      walls: {
        ...current.walls,
        [wallId]: {
          ...current.walls[wallId],
          [property]: parsed.millimeters,
        },
      },
    }));
    setValue(parsed.normalized);
    setError('');
  };

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>墙体属性</div>
      <div className={styles.content}>
        <div className={styles.readOnly}>{wallId}</div>
        <label className={styles.field}>
          <span>墙长（米）</span>
          <input
            aria-label="墙长（米）"
            inputMode="decimal"
            value={length}
            onChange={(event) => setLength(event.target.value)}
            onBlur={commitLength}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitLength();
            }}
          />
        </label>
        <label className={styles.field}>
          <span>固定端</span>
          <select
            aria-label="固定端"
            value={fixedAnchor}
            onChange={(event) =>
              setFixedAnchor(event.target.value as WallLengthAnchor)
            }
          >
            <option value="start">固定起点</option>
            <option value="end">固定终点</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>墙厚（米）</span>
          <input
            aria-label="墙厚（米）"
            inputMode="decimal"
            value={thickness}
            onChange={(event) => setThickness(event.target.value)}
            onBlur={() =>
              commitDimension(
                '墙厚',
                thickness,
                'thickness_mm',
                setThickness,
              )
            }
          />
        </label>
        <label className={styles.field}>
          <span>墙高（米）</span>
          <input
            aria-label="墙高（米）"
            inputMode="decimal"
            value={height}
            onChange={(event) => setHeight(event.target.value)}
            onBlur={() =>
              commitDimension('墙高', height, 'height_mm', setHeight)
            }
          />
        </label>
        <label className={styles.field}>
          <span>墙体类型</span>
          <select
            aria-label="墙体类型"
            value={wall.wall_type}
            onChange={(event) =>
              transact('修改墙体类型', (current) => ({
                ...current,
                walls: {
                  ...current.walls,
                  [wallId]: {
                    ...current.walls[wallId],
                    wall_type: event.target.value as typeof wall.wall_type,
                  },
                },
              }))
            }
          >
            <option value="exterior">外墙</option>
            <option value="interior">内墙</option>
            <option value="partition">隔墙</option>
          </select>
        </label>
        {error && <div className={styles.error}>{error}</div>}
      </div>
    </aside>
  );
}

function ReferenceProperties() {
  const image = useEditorStore(
    (state) => state.buildingDocument!.reference_image,
  );
  const transact = useEditorStore((state) => state.transact);
  const [opacity, setOpacity] = useState(String(image.opacity));
  const [scale, setScale] = useState(String(image.transform.scale));
  const [rotation, setRotation] = useState(
    String(image.transform.rotation_deg),
  );
  const [translateX, setTranslateX] = useState(
    String(image.transform.translate_x_mm / 1000),
  );
  const [translateY, setTranslateY] = useState(
    String(image.transform.translate_y_mm / 1000),
  );

  const updateImage = (
    description: string,
    update: (current: typeof image) => typeof image,
  ) =>
    transact(description, (document) => ({
      ...document,
      reference_image: update(document.reference_image),
    }));

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>参考草图</div>
      <div className={styles.content}>
        <div className={styles.readOnly}>{image.path}</div>
        <label className={styles.field}>
          <span>透明度</span>
          <input
            aria-label="透明度"
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={opacity}
            onChange={(event) => setOpacity(event.target.value)}
            onBlur={() => {
              const value = Number(opacity);
              if (!Number.isFinite(value)) return;
              updateImage('修改参考图透明度', (current) =>
                setReferenceOpacity(current, value),
              );
            }}
          />
        </label>
        <label className={styles.field}>
          <span>缩放</span>
          <input
            aria-label="参考图缩放"
            type="number"
            min="0.05"
            max="20"
            step="0.05"
            value={scale}
            onChange={(event) => setScale(event.target.value)}
            onBlur={() => {
              const value = Number(scale);
              if (!Number.isFinite(value) || value <= 0) return;
              updateImage('缩放参考图', (current) =>
                scaleReference(current, value / current.transform.scale),
              );
            }}
          />
        </label>
        <label className={styles.field}>
          <span>旋转（度）</span>
          <input
            aria-label="参考图旋转"
            type="number"
            value={rotation}
            onChange={(event) => setRotation(event.target.value)}
            onBlur={() => {
              const value = Number(rotation);
              if (!Number.isFinite(value)) return;
              updateImage('旋转参考图', (current) =>
                rotateReference(
                  current,
                  value - current.transform.rotation_deg,
                ),
              );
            }}
          />
        </label>
        <label className={styles.field}>
          <span>水平位置（米）</span>
          <input
            aria-label="参考图水平位置"
            type="number"
            step="0.1"
            value={translateX}
            onChange={(event) => setTranslateX(event.target.value)}
            onBlur={() => {
              const valueMm = Math.round(Number(translateX) * 1000);
              if (!Number.isFinite(valueMm)) return;
              updateImage('平移参考图', (current) =>
                translateReference(
                  current,
                  valueMm - current.transform.translate_x_mm,
                  0,
                ),
              );
            }}
          />
        </label>
        <label className={styles.field}>
          <span>垂直位置（米）</span>
          <input
            aria-label="参考图垂直位置"
            type="number"
            step="0.1"
            value={translateY}
            onChange={(event) => setTranslateY(event.target.value)}
            onBlur={() => {
              const valueMm = Math.round(Number(translateY) * 1000);
              if (!Number.isFinite(valueMm)) return;
              updateImage('平移参考图', (current) =>
                translateReference(
                  current,
                  0,
                  valueMm - current.transform.translate_y_mm,
                ),
              );
            }}
          />
        </label>
      </div>
    </aside>
  );
}
