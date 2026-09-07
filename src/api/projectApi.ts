import type {
  BuildingDocument,
  CustomFunctionType,
  HouseholdSurvey,
} from '@/editor/domain/buildingTypes.ts';

// ---- 类型定义 ----

export interface ProjectCheck {
  status: 'unchecked' | 'passed' | 'warning' | 'error';
  revision?: number;
  checked_at?: string;
  issues: Array<{ severity: string; code: string; message: string }>;
}
export interface ProjectCheckResult {
  outcome: 'checked' | 'completed' | 'failed' | 'skipped';
  summary: ProjectSummary;
}
export function checkProject(buildingId: string, clientRevision: number, complete = false): Promise<ProjectCheckResult> {
  return requestJson(`/api/projects/${encodeURIComponent(buildingId)}/${complete ? 'auto-complete' : 'check'}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientRevision }),
  });
}
export interface ProjectSummary {
  non_axis_aligned_wall_count?: number;
  non_axis_aligned_face_edge_count?: number;
  check?: ProjectCheck;
  building_id: string;
  name: string;
  updated_at: string;
  status: string;
  revision: number;
  room_count: number;
  total_floor_area_m2: number;
  geometry_progress: number;
  room_semantic_progress: number;
  opening_progress: number;
  validation_error_count: number;
  validation_warning_count: number;
  preview_kind: 'empty' | 'reference' | 'vector';
  has_reference_image: boolean;
}

export interface RevisionEntry {
  revision: number;
  timestamp: string;
  status: string;
  notes?: string;
}

export interface NewProjectInput {
  building_id: string;
  image_name: string;
  image_mime: 'image/jpeg' | 'image/png' | 'image/webp';
  image_base64: string;
  width_px: number;
  height_px: number;
  wall_thickness_mm?: number;
}

export interface OpenProjectResult {
  document: BuildingDocument;
  recovered_from_draft: boolean;
}

export type ReferenceImageUploadInput = Omit<
  NewProjectInput,
  'building_id' | 'wall_thickness_mm'
>;

export interface BulkSurveyImportResult {
  created: string[];
  updated: string[];
}

export interface RoomFunctionTemplateInput {
  name: string;
  color: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    message: string,
    status: number,
    code: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// ---- 项目 CRUD ----

export function listProjects(): Promise<ProjectSummary[]> {
  return requestJson('/api/projects');
}

export function createProject(
  input: NewProjectInput,
): Promise<BuildingDocument> {
  return requestJson('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function bulkImportSurveys(
  records: HouseholdSurvey[],
): Promise<BulkSurveyImportResult> {
  return requestJson('/api/projects/surveys/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ records }),
  });
}

export function uploadReferenceImage(
  buildingId: string,
  input: ReferenceImageUploadInput,
): Promise<BuildingDocument> {
  return requestJson(`/api/projects/${encodeURIComponent(buildingId)}/reference`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function removeReferenceImage(
  buildingId: string,
): Promise<BuildingDocument> {
  return requestJson(`/api/projects/${encodeURIComponent(buildingId)}/reference`, {
    method: 'DELETE',
  });
}

export function projectPreviewUrl(buildingId: string, revision?: number): string {
  const base = `/api/projects/${encodeURIComponent(buildingId)}/preview`;
  if (typeof revision !== 'number') return base;
  return `${base}?v=${revision}`;
}

export function listRoomFunctionTemplates(): Promise<CustomFunctionType[]> {
  return requestJson('/api/settings/room-functions');
}

export function createRoomFunctionTemplate(
  input: RoomFunctionTemplateInput,
): Promise<CustomFunctionType> {
  return requestJson('/api/settings/room-functions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateRoomFunctionTemplate(
  code: string,
  input: RoomFunctionTemplateInput,
): Promise<CustomFunctionType> {
  return requestJson(`/api/settings/room-functions/${encodeURIComponent(code)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteRoomFunctionTemplate(code: string): Promise<void> {
  return requestJson(`/api/settings/room-functions/${encodeURIComponent(code)}`, {
    method: 'DELETE',
  });
}

export function openProject(
  buildingId: string,
): Promise<OpenProjectResult> {
  return requestJson(`/api/projects/${encodeURIComponent(buildingId)}`);
}

export function openProjectFolder(buildingId: string): Promise<void> {
  return requestEmpty(
    `/api/projects/${encodeURIComponent(buildingId)}/open-folder`,
    { method: 'POST' },
  );
}

// ---- 自动保存（带 revision 锁） ----

export function autosaveProject(
  buildingId: string,
  document: BuildingDocument,
  signal?: AbortSignal,
): Promise<BuildingDocument> {
  // 发送时附带客户端 revision（服务端乐观锁校验）
  const body = {
    ...document,
    _clientRevision: document.metadata?.revision,
  };
  return requestJson(
    `/api/projects/${encodeURIComponent(buildingId)}/autosave`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    },
  );
}

// ---- v2.1.0: 工作流 ----

export function submitReview(
  buildingId: string,
  document: BuildingDocument,
): Promise<BuildingDocument> {
  return requestJson(
    `/api/projects/${encodeURIComponent(buildingId)}/submit-review`,
    commandRequest(document),
  );
}

export function reviewProject(
  buildingId: string,
  document: BuildingDocument,
  reviewer?: string,
): Promise<BuildingDocument> {
  return requestJson(
    `/api/projects/${encodeURIComponent(buildingId)}/review`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        document,
        client_revision: document.metadata.revision,
        ...(reviewer ? { reviewer } : {}),
      }),
    },
  );
}

export function completeProject(
  buildingId: string,
  document: BuildingDocument,
): Promise<BuildingDocument> {
  return requestJson(
    `/api/projects/${encodeURIComponent(buildingId)}/complete`,
    commandRequest(document),
  );
}

export function reopenProject(
  buildingId: string,
): Promise<BuildingDocument> {
  return requestJson(
    `/api/projects/${encodeURIComponent(buildingId)}/reopen`,
    { method: 'POST' },
  );
}

// ---- v2.1.0: Revision 历史 ----

export function listRevisions(
  buildingId: string,
): Promise<RevisionEntry[]> {
  return requestJson(
    `/api/projects/${encodeURIComponent(buildingId)}/revisions`,
  );
}

export function getRevision(
  buildingId: string,
  revision: number,
): Promise<BuildingDocument> {
  return requestJson(
    `/api/projects/${encodeURIComponent(buildingId)}/revisions/${revision}`,
  );
}

export function restoreRevision(
  buildingId: string,
  revision: number,
): Promise<BuildingDocument> {
  return requestJson(
    `/api/projects/${encodeURIComponent(buildingId)}/revisions/${revision}/restore`,
    { method: 'POST' },
  );
}

// ---- 删除与恢复 ----

export function trashProject(buildingId: string): Promise<void> {
  return requestJson(
    `/api/projects/${encodeURIComponent(buildingId)}`,
    { method: 'DELETE' },
  );
}

export function listTrashedProjects(): Promise<ProjectSummary[]> {
  return requestJson('/api/projects/trash');
}

export function restoreProject(
  buildingId: string,
): Promise<BuildingDocument> {
  return requestJson(
    `/api/projects/${encodeURIComponent(buildingId)}/restore`,
    { method: 'POST' },
  );
}

// ---- 导出 ----

export interface ExportUrlOptions {
  scale?: string;
  scaleBar?: boolean;
}

export function exportProjectUrl(
  buildingId: string,
  options?: ExportUrlOptions,
): string {
  const url = `/api/projects/${encodeURIComponent(buildingId)}/export`;
  if (!options) return url;
  const params = new URLSearchParams();
  if (options.scale) params.set('scale', options.scale);
  if (options.scaleBar) params.set('scaleBar', 'true');
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export interface ExportProjectResult {
  blob: Blob;
  revision: number;
  document: BuildingDocument;
}

export async function exportProject(
  buildingId: string,
  document: BuildingDocument,
  options: ExportUrlOptions,
): Promise<ExportProjectResult> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(buildingId)}/export`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        document,
        client_revision: document.metadata.revision,
        options: {
          scale: options.scale,
          scale_bar: options.scaleBar === true,
        },
      }),
    },
  );
  if (!response.ok) {
    await throwResponseError(response);
  }
  const revision = Number(response.headers.get('x-building-revision'));
  const blob = await response.blob();
  const opened = await openProject(buildingId);
  return {
    blob,
    revision: Number.isInteger(revision)
      ? revision
      : opened.document.metadata.revision,
    document: opened.document,
  };
}

export async function downloadProjectArchive(
  buildingId: string,
  options: ExportUrlOptions = { scale: '1:200', scaleBar: false },
): Promise<Blob> {
  const response = await fetch(exportProjectUrl(buildingId, options));
  if (!response.ok) await throwResponseError(response);
  return response.blob();
}

// ---- HTTP 工具 ----

async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  const body = (await response.json()) as
    | T
    | { error?: { code?: string; message?: string } };
  if (!response.ok) {
    const error =
      'error' in (body as object)
        ? (body as { error?: { code?: string; message?: string } }).error
        : undefined;
    throw new ApiError(
      error?.message ?? `请求失败 (${response.status})`,
      response.status,
      error?.code ?? 'REQUEST_FAILED',
    );
  }
  return body as T;
}

async function requestEmpty(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<void> {
  const response = await fetch(input, init);
  if (!response.ok) await throwResponseError(response);
}

function commandRequest(document: BuildingDocument): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      document,
      client_revision: document.metadata.revision,
    }),
  };
}

async function throwResponseError(response: Response): Promise<never> {
  let error: { code?: string; message?: string } | undefined;
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    error = body.error;
  } catch {
    // Binary or empty error responses use the generic status message.
  }
  throw new ApiError(
    error?.message ?? `请求失败 (${response.status})`,
    response.status,
    error?.code ?? 'REQUEST_FAILED',
  );
}
