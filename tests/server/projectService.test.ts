// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectService } from '../../server/projectService.ts';
import { ServiceError } from '../../server/errors.ts';

describe('ProjectService', () => {
  let testRoot: string;
  let dataRoot: string;
  let service: ProjectService;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rural-plan-'));
    dataRoot = path.join(testRoot, 'data');
    service = new ProjectService(dataRoot);
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('creates a complete draft package while preserving image bytes', async () => {
    const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const document = await service.create({
      buildingId: 'house_0001',
      image: {
        bytes: imageBytes,
        extension: 'png',
        mimeType: 'image/png',
        widthPx: 640,
        heightPx: 480,
      },
    });
    const buildingDir = path.join(dataRoot, 'house_0001');

    expect(document.reference_image).toMatchObject({
      path: 'reference/original.png',
      mime_type: 'image/png',
      width_px: 640,
      height_px: 480,
    });
    await expect(
      fs.readFile(path.join(buildingDir, 'reference', 'original.png')),
    ).resolves.toEqual(imageBytes);
    await expect(
      fs.stat(path.join(buildingDir, 'preview')),
    ).resolves.toMatchObject({ isDirectory: expect.any(Function) });

    const draft = JSON.parse(
      await fs.readFile(
        path.join(buildingDir, 'draft', 'building.autosave.json'),
        'utf8',
      ),
    );
    expect(draft.schema_version).toBe('2.1.0');
    expect(draft.building_id).toBe('house_0001');
  });

  it('rejects a duplicate building ID', async () => {
    const input = {
      buildingId: 'house_0001',
      image: {
        bytes: Buffer.from('image'),
        extension: 'jpg',
        mimeType: 'image/jpeg',
        widthPx: 100,
        heightPx: 100,
      },
    };
    await service.create(input);

    await expect(service.create(input)).rejects.toMatchObject<ServiceError>({
      status: 409,
      code: 'BUILDING_EXISTS',
    });
  });

  it('increments revisions during autosave and returns projects in the list', async () => {
    const created = await service.create({
      buildingId: 'house_0001',
      image: {
        bytes: Buffer.from('image'),
        extension: 'jpg',
        mimeType: 'image/jpeg',
        widthPx: 100,
        heightPx: 100,
      },
    });

    const saved = await service.autosave('house_0001', {
      ...created,
      metadata: {
        ...created.metadata,
        revision: 99,
      },
    });

    expect(saved.metadata.revision).toBe(1);
    await expect(service.list()).resolves.toMatchObject([
      {
        building_id: 'house_0001',
        status: 'draft',
      },
    ]);
  });

  it('opens the newer draft instead of an older final document', async () => {
    const created = await service.create({
      buildingId: 'house_0001',
      image: {
        bytes: Buffer.from('image'),
        extension: 'webp',
        mimeType: 'image/webp',
        widthPx: 100,
        heightPx: 100,
      },
    });
    const buildingDir = path.join(dataRoot, 'house_0001');
    await fs.writeFile(
      path.join(buildingDir, 'building.json'),
      JSON.stringify({
        ...created,
        metadata: { ...created.metadata, revision: 0, status: 'complete' },
      }),
    );
    const saved = await service.autosave('house_0001', created);

    const opened = await service.open('house_0001');

    expect(opened.recovered_from_draft).toBe(true);
    expect(opened.document.metadata.revision).toBe(saved.metadata.revision);
  });
});
