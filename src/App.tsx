import { useState } from 'react';
import { EditorLayout } from '@/editor/EditorLayout.tsx';
import { ProjectHome } from '@/projects/ProjectHome.tsx';
import { openProject } from '@/api/projectApi.ts';
import type { BuildingDocument } from '@/editor/domain/buildingTypes.ts';
import { useEditorStore } from '@/editor/store/editorStore.ts';

function App() {
  const [screen, setScreen] = useState<'home' | 'editor'>('home');
  const loadBuilding = useEditorStore((state) => state.loadBuilding);
  const closeBuilding = useEditorStore((state) => state.closeBuilding);

  const handleOpen = async (
    buildingId: string,
    document?: BuildingDocument,
  ) => {
    const loaded = document ?? (await openProject(buildingId)).document;
    loadBuilding(loaded);
    setScreen('editor');
  };

  if (screen === 'home') {
    return <ProjectHome onOpen={handleOpen} />;
  }

  return (
    <EditorLayout
      onBack={() => {
        closeBuilding();
        setScreen('home');
      }}
    />
  );
}

export default App;
