import { useCallback, useEffect, useState } from 'react';
import type { CustomFunctionType } from '@/editor/domain/buildingTypes.ts';
import {
  createRoomFunctionTemplate,
  deleteRoomFunctionTemplate,
  listRoomFunctionTemplates,
  updateRoomFunctionTemplate,
} from '@/api/projectApi.ts';

export function useRoomFunctionTemplates() {
  const [templates, setTemplates] = useState<CustomFunctionType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setTemplates(await listRoomFunctionTemplates());
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取房间模板');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const createTemplate = async (name: string, color: string) => {
    const created = await createRoomFunctionTemplate({ name, color });
    setTemplates((current) => [...current, created]);
    return created;
  };

  const updateTemplate = async (code: string, name: string, color: string) => {
    const updated = await updateRoomFunctionTemplate(code, { name, color });
    setTemplates((current) =>
      current.map((item) => item.code === code ? updated : item),
    );
    return updated;
  };

  const deleteTemplate = async (code: string) => {
    await deleteRoomFunctionTemplate(code);
    setTemplates((current) => current.filter((item) => item.code !== code));
  };

  return {
    templates,
    loading,
    error,
    setError,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  };
}

