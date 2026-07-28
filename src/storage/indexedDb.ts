// ============================================================
// IndexedDB 存储模块
// ============================================================

import { DB_NAME, DB_VERSION, DB_STORE_NAME } from '@/editor/domain/constants.ts';
import type { PlanDocument } from '@/editor/domain/planTypes.ts';

interface DbProject {
  id: string;
  plan_id: string;
  data: PlanDocument;
  updated_at: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(DB_STORE_NAME)) {
        const store = db.createObjectStore(DB_STORE_NAME, { keyPath: 'id' });
        store.createIndex('plan_id', 'plan_id', { unique: false });
        store.createIndex('updated_at', 'updated_at', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject(new Error(`IndexedDB 打开失败: ${(event.target as IDBOpenDBRequest).error}`));
    };
  });
}

/**
 * 保存项目到 IndexedDB
 */
export async function saveProject(doc: PlanDocument): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(DB_STORE_NAME);

    const project: DbProject = {
      id: 'current_project',
      plan_id: doc.plan_id,
      data: doc,
      updated_at: new Date().toISOString(),
    };

    const request = store.put(project);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('保存失败'));

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * 从 IndexedDB 加载项目
 */
export async function loadProject(): Promise<PlanDocument | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE_NAME, 'readonly');
    const store = transaction.objectStore(DB_STORE_NAME);
    const request = store.get('current_project');

    request.onsuccess = () => {
      const project: DbProject | undefined = request.result;
      if (project) {
        resolve(project.data);
      } else {
        resolve(null);
      }
    };

    request.onerror = () => reject(new Error('读取失败'));

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * 删除当前项目
 */
export async function deleteProject(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(DB_STORE_NAME);
    const request = store.delete('current_project');

    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('删除失败'));

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * 获取项目列表
 */
export async function listProjects(): Promise<DbProject[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE_NAME, 'readonly');
    const store = transaction.objectStore(DB_STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => reject(new Error('读取列表失败'));

    transaction.oncomplete = () => {
      db.close();
    };
  });
}
