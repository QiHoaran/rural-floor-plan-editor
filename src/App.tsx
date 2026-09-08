import { lazy, Suspense, useCallback, useRef, useState, type CSSProperties } from 'react';
import { ProjectHome } from '@/projects/ProjectHome.tsx';
import { openProject } from '@/api/projectApi.ts';
import type { BuildingDocument } from '@/editor/domain/buildingTypes.ts';
import { loadEditorDocument, closeEditorDocument } from '@/editor/loadEditor.ts';

// 编辑器整体懒加载：入口 chunk 不再包含 SvgCanvas、各面板与几何/拓扑模块。
const EditorLayout = lazy(() =>
  import('@/editor/EditorLayout.tsx').then((module) => ({ default: module.EditorLayout })));

const FALLBACK_STYLE: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  height: '100vh',
  color: '#64748b',
};

function App() {
  const [screen, setScreen] = useState<'home' | 'editor'>('home');
  const openingRef = useRef(false);

  const handleOpen = useCallback(async (
    buildingId: string,
    document?: BuildingDocument,
  ) => {
    if (openingRef.current) return;
    openingRef.current = true;
    try {
      const [loaded] = await Promise.all([
        document ?? openProject(buildingId).then((result) => result.document),
        // 与取文档并行预载编辑器 chunk，让 Suspense 兜底最多只闪一帧。
        import('@/editor/EditorLayout.tsx'),
      ]);
      await loadEditorDocument(loaded);
      setScreen('editor');
    } finally {
      openingRef.current = false;
    }
  }, []);

  const handleBack = useCallback(() => {
    void closeEditorDocument();
    setScreen('home');
  }, []);

  if (screen === 'home') {
    return <ProjectHome onOpen={handleOpen} />;
  }

  return (
    <Suspense fallback={<div style={FALLBACK_STYLE}>正在加载编辑器…</div>}>
      <EditorLayout onBack={handleBack} />
    </Suspense>
  );
}

export default App;
