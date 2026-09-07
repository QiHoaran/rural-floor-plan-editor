import { ApiError } from './projectApi.ts';

export interface ConversionFormat {
  id: string;
  label: string;
  directory: string;
  version: string;
  available: boolean;
  reason?: string;
}
export interface ConversionItem {
  buildingId: string;
  format: string;
  status: 'queued' | 'running' | 'succeeded' | 'skipped' | 'quarantined' | 'failed';
  message?: string;
}
export interface ConversionJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'interrupted';
  outputRoot: string;
  items: ConversionItem[];
  message?: string;
}
export interface ConversionRequest {
  projects: Array<{ buildingId: string; revision: number }>;
  formats: string[];
  outputRoot: string;
  overwrite: boolean;
}
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new ApiError(detail.error?.message ?? `请求失败 (${response.status})`, response.status, detail.error?.code ?? 'CONVERSION_FAILED');
  }
  return response.status === 204 ? undefined as T : response.json();
}
export const listConversionFormats = () => request<{ formats: ConversionFormat[] }>('/api/conversions/formats');
export const startConversion = (input: ConversionRequest) => request<ConversionJob>('/api/conversions', input);
export const getConversion = (id: string) => request<ConversionJob>(`/api/conversions/${encodeURIComponent(id)}`);
export const recoverConversion = (saved: { id: string; outputRoot: string }) => request<ConversionJob>('/api/conversions/recover', saved);
export const openConversionFolder = (id: string) => request<void>(`/api/conversions/${encodeURIComponent(id)}/open`, {});
