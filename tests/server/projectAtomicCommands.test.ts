// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectService } from '../../server/projectService.ts';
import type { BuildingDocument } from '../../src/editor/domain/buildingTypes.ts';

describe('ProjectService atomic commands', () => {
  let testRoot: string;
  let dataRoot: string;
  let service: ProjectService;
  let created: BuildingDocument;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rural-atomic-'));
    dataRoot = path.join(testRoot, 'data');
    service = new ProjectService(dataRoot);
    created = await service.create({
      buildingId: 'house_0001',
      image: {
        bytes: Buffer.from('image'),
        extension: 'png',
        mimeType: 'image/png',
        widthPx: 100,
        heightPx: 100,
      },
    });
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('serializes concurrent writes so only one matching revision succeeds', async () => {
    const results = await Promise.allSettled([
      service.autosave(
        'house_0001',
        { ...created, metadata: { ...created.metadata, name: 'first' } },
        0,
      ),
      service.autosave(
        'house_0001',
        { ...created, metadata: { ...created.metadata, name: 'second' } },
        0,
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected');
    expect(rejection).toMatchObject({
      status: 'rejected',
      reason: { code: 'REVISION_CONFLICT', status: 409 },
    });
  });

  it('rejects draft completion even when the document is otherwise export-ready', async () => {
    const document = researchReady(created);

    await expect(
      service.complete('house_0001', {
        document,
        clientRevision: 0,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      status: 409,
    });
  });

  it('commits the submitted reviewed document as one completed revision', async () => {
    const ready = researchReady(created);
    const pending = await service.submitReview('house_0001', {
      document: ready,
      clientRevision: 0,
    });
    const reviewed = await service.review(
      'house_0001',
      {
        document: pending,
        clientRevision: 1,
      },
      'reviewer',
    );
    const document = {
      ...reviewed,
      metadata: {
        ...reviewed.metadata,
      name: 'submitted-current-document',
      },
    };

    const completed = await service.complete('house_0001', {
      document,
      clientRevision: 2,
    });

    expect(completed.metadata).toMatchObject({
      revision: 3,
      status: 'complete',
      name: 'submitted-current-document',
    });
    expect(completed.workflow.status).toBe('complete');

    const buildingDir = path.join(dataRoot, 'house_0001');
    const [draft, final] = await Promise.all([
      readJson(path.join(buildingDir, 'draft', 'building.autosave.json')),
      readJson(path.join(buildingDir, 'building.json')),
    ]);
    expect(draft).toEqual(final);
    expect(final.metadata.revision).toBe(3);
  });

  it('exports a submitted snapshot with every research artifact', async () => {
    const document = researchReady(created);
    document.metadata.name = 'exported-current-document';

    const result = await service.exportSubmittedToZip('house_0001', {
      document,
      clientRevision: 0,
      options: { scale: '1:200', scaleBar: true },
    });

    expect(result.document.metadata).toMatchObject({
      revision: 1,
      name: 'exported-current-document',
    });
    const zip = await fs.readFile(result.zipPath);
    for (const filename of [
      'building.json',
      'spatial_graph.json',
      'building.geojson',
      'floorplan.png',
      'reference.png',
      'metadata.json',
    ]) {
      expect(zip.includes(Buffer.from(filename))).toBe(true);
    }
  });

  it('serializes reopen commands so a completed revision is reopened once', async () => {
    const pending = await service.submitReview('house_0001', {
      document: researchReady(created),
      clientRevision: 0,
    });
    const reviewed = await service.review('house_0001', {
      document: pending,
      clientRevision: 1,
    });
    await service.complete('house_0001', {
      document: reviewed,
      clientRevision: 2,
    });

    const results = await Promise.allSettled([
      service.reopen('house_0001'),
      service.reopen('house_0001'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: { code: 'INVALID_TRANSITION', status: 409 },
    });
  });
});

function researchReady(document: BuildingDocument): BuildingDocument {
  return {
    ...structuredClone(document),
    metadata: {
      ...document.metadata,
      village_code: 'village_1',
    },
    site: {
      north_angle_deg: 0,
      location_name: 'Village',
    },
    reference_calibration: {
      calibrated: true,
      point_a_image: { x: 0, y: 0 },
      point_b_image: { x: 100, y: 0 },
      real_distance_mm: 1000,
      mm_per_image_pixel: 10,
      calibrated_at: '2026-07-28T00:00:00.000Z',
    },
  };
}

async function readJson(filePath: string): Promise<any> {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}
