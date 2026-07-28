import type {
  BuildingDocument,
  BuildingValidationIssue,
} from '@/editor/domain/buildingTypes.ts';

export interface ProjectSummary {
  building_id: string;
  updated_at: string;
  status: 'draft' | 'complete';
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

export interface CompleteProjectResult {
  building_id: string;
  files: string[];
  warnings: BuildingValidationIssue[];
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

export function openProject(
  buildingId: string,
): Promise<OpenProjectResult> {
  return requestJson(`/api/projects/${encodeURIComponent(buildingId)}`);
}

export function autosaveProject(
  buildingId: string,
  document: BuildingDocument,
  signal?: AbortSignal,
): Promise<BuildingDocument> {
  return requestJson(
    `/api/projects/${encodeURIComponent(buildingId)}/autosave`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(document),
      signal,
    },
  );
}

export function completeProject(
  buildingId: string,
  document: BuildingDocument,
): Promise<CompleteProjectResult> {
  return requestJson(
    `/api/projects/${encodeURIComponent(buildingId)}/complete`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(document),
    },
  );
}

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
