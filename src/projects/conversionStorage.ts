export const CONVERSION_PATH_KEY = 'rural.conversions.outputRoot';
export const CONVERSION_JOB_KEY = 'rural.conversions.activeJob';
export function readSavedJob(): { id: string; outputRoot: string } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(CONVERSION_JOB_KEY) ?? 'null');
    return typeof saved?.id === 'string' && typeof saved?.outputRoot === 'string' ? saved : null;
  } catch { return null; }
}
export function hasSavedConversion(): boolean { return readSavedJob() !== null; }
export function readConversionPath(): string { try { return localStorage.getItem(CONVERSION_PATH_KEY) ?? ''; } catch { return ''; } }
