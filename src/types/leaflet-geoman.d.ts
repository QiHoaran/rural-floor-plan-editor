import type L from 'leaflet';

/**
 * Leaflet-Geoman 类型声明（最小化版本）
 * 仅声明需要使用的部分，不污染 Leaflet 核心类型
 */

// Geoman 控制选项
interface PMControlsOptions {
  position?: string;
  drawMarker?: boolean;
  drawCircleMarker?: boolean;
  drawPolyline?: boolean;
  drawRectangle?: boolean;
  drawPolygon?: boolean;
  drawCircle?: boolean;
  drawText?: boolean;
  cutPolygon?: boolean;
  editMode?: boolean;
  dragMode?: boolean;
  cutMode?: boolean;
  removalMode?: boolean;
  rotateMode?: boolean;
  snappingOption?: boolean;
}

// Geoman 绘制选项
interface PMDrawOptions {
  snappable?: boolean;
  snapDistance?: number;
  snapMiddle?: boolean;
  requireSnapToFinish?: boolean;
  allowSelfIntersection?: boolean;
  templineStyle?: Record<string, unknown>;
  hintlineStyle?: Record<string, unknown>;
  finishOn?: string;
  continueDrawing?: boolean;
}

// Geoman 编辑选项
interface PMEditOptions {
  snappable?: boolean;
  snapDistance?: number;
  allowSelfIntersection?: boolean;
  draggable?: boolean;
  allowEditing?: boolean;
  preventMarkerDelete?: boolean;
  hideMiddleMarkers?: boolean;
  snapMiddle?: boolean;
  markerStyle?: Record<string, unknown>;
}

// Geoman Map API
interface PMMap {
  addControls(options?: PMControlsOptions): void;
  removeControls(): void;
  enableDraw(shape: string, options?: PMDrawOptions): void;
  disableDraw(shape: string): void;
  setOptions(options: Record<string, unknown>): void;
  Toolbar: {
    btnClick(name: string): void;
    getButtons(): Array<{ name: string; active: boolean }>;
  };
}

// Layer
interface PMLayer {
  enableEdit(options?: PMEditOptions): void;
  disableEdit(): void;
  enableDrag(options?: PMEditOptions): void;
  disableDrag(): void;
  enableRemove(options?: Record<string, unknown>): void;
  disableRemove(): void;
  setOptions(options: PMEditOptions): void;
}

// Geoman 事件数据
interface PMEventData {
  layer: any;
  shape?: string;
  workingLayer?: any;
  latlng?: L.LatLng;
  source?: any;
}

// 扩展 Map 类型
declare module 'leaflet' {
  interface Map {
    pm: PMMap;
  }
}
