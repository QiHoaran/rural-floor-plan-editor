// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app.ts';
import type { ServerConfig } from '../../server/config.ts';

describe('projects API', () => {
  let testRoot: string;
  let config: ServerConfig;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rural-api-'));
    config = {
      projectRoot: testRoot,
      dataRoot: path.join(testRoot, 'data'),
      port: 0,
      development: false,
    };
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('creates, lists, opens, and autosaves a project', async () => {
    const app = await createApp(config);
    const pngBytes = await sharp({
      create: { width: 4, height: 3, channels: 3, background: '#ff0000' },
    }).png().toBuffer();

    await request(app).get('/api/projects').expect(200, []);

    const created = await request(app)
      .post('/api/projects')
      .send({
        building_id: 'house_0001',
        image_name: 'sketch.png',
        image_mime: 'image/png',
        image_base64: pngBytes.toString('base64'),
        width_px: 640,
        height_px: 480,
      })
      .expect(201);

    expect(created.body.building_id).toBe('house_0001');

    const image = await request(app)
      .get('/api/projects/house_0001/files/reference/original.png')
      .expect(200);
    expect(image.body).toEqual(pngBytes);

    const listed = await request(app).get('/api/projects').expect(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].building_id).toBe('house_0001');
    expect(listed.body[0]).toMatchObject({
      preview_kind: 'reference',
      has_reference_image: true,
    });

    const referencePreview = await request(app)
      .get('/api/projects/house_0001/preview')
      .expect('Content-Type', /image\/webp/)
      .expect(200);
    expect(Buffer.from(referencePreview.body).length).toBeGreaterThan(0);
    const previewFiles = await fs.readdir(
      path.join(config.dataRoot, 'house_0001', 'preview'),
    );
    expect(previewFiles).toContain('thumbnail.webp');
    expect(previewFiles).toContain('preview.meta.json');

    const opened = await request(app)
      .get('/api/projects/house_0001')
      .expect(200);
    expect(opened.body.document.building_id).toBe('house_0001');
    expect(opened.body.recovered_from_draft).toBe(false);

    const saved = await request(app)
      .put('/api/projects/house_0001/autosave')
      .send({ ...created.body, _clientRevision: 0 })
      .expect(200);
    expect(saved.body.metadata.revision).toBe(1);
    expect(saved.body).not.toHaveProperty('_clientRevision');

    const withWall = structuredClone(saved.body);
    withWall.vertices = {
      v1: { x_mm: 0, y_mm: 0 },
      v2: { x_mm: 3000, y_mm: 0 },
    };
    withWall.walls = {
      w1: {
        start_vertex_id: 'v1',
        end_vertex_id: 'v2',
        wall_type: 'exterior',
        thickness_mm: 240,
        height_mm: 3000,
        material_type: 'brick',
      },
    };
    withWall.floors[0].wall_ids = ['w1'];
    await request(app)
      .put('/api/projects/house_0001/autosave')
      .send({ ...withWall, _clientRevision: 1 })
      .expect(200);
    const vectorPreview = await request(app)
      .get('/api/projects/house_0001/preview')
      .expect('Content-Type', /image\/svg\+xml/)
      .expect(200);
    expect(Buffer.from(vectorPreview.body).toString('utf8')).toContain('<polygon');
    const vectorListed = await request(app).get('/api/projects').expect(200);
    expect(vectorListed.body[0].preview_kind).toBe('vector');
  });

  it('returns a structured conflict for duplicate IDs', async () => {
    const app = await createApp(config);
    const input = {
      building_id: 'house_0001',
      image_name: 'sketch.jpg',
      image_mime: 'image/jpeg',
      image_base64: Buffer.from('jpeg-data').toString('base64'),
      width_px: 100,
      height_px: 100,
    };
    await request(app).post('/api/projects').send(input).expect(201);

    const duplicate = await request(app)
      .post('/api/projects')
      .send(input)
      .expect(409);

    expect(duplicate.body).toEqual({
      error: {
        code: 'BUILDING_EXISTS',
        message: '建筑 house_0001 已存在',
      },
    });
  });

  it('bulk imports survey rows into padded JSON projects and updates duplicates', async () => {
    const app = await createApp(config);
    const first = await request(app)
      .post('/api/projects/surveys/bulk')
      .send({ records: [
        { village_code: '1', household_code: '1', gender: 1, age: 69, construction_era: 9, clear_height_m: 2.5 },
        { village_code: '1', household_code: '2', gender: 2, age: 65 },
      ] })
      .expect(200);

    expect(first.body).toEqual({
      created: ['rural_001_house_0001', 'rural_001_house_0002'],
      updated: [],
    });
    const opened = await request(app)
      .get('/api/projects/rural_001_house_0001')
      .expect(200);
    expect(opened.body.document.survey).toMatchObject({
      village_code: '1', household_code: '1', gender: '男性', age: 69, construction_era: '1920 年代及以前', clear_height_mm: 2500,
    });
    expect(opened.body.document.reference_image.path).toBe('');
    expect(opened.body.document.building_defaults.wall_height_mm).toBe(2500);

    const second = await request(app)
      .post('/api/projects/surveys/bulk')
      .send({ records: [
        { village_code: '1', household_code: '1', gender: 1, age: 70 },
      ] })
      .expect(200);
    expect(second.body).toEqual({ created: [], updated: ['rural_001_house_0001'] });
    const updated = await request(app)
      .get('/api/projects/rural_001_house_0001')
      .expect(200);
    expect(updated.body.document.survey.age).toBe(70);
    expect(updated.body.document.metadata.revision).toBe(1);
  });

  it('attaches a reference image after a survey-only import without allowing overwrite', async () => {
    const app = await createApp(config);
    await request(app)
      .post('/api/projects/surveys/bulk')
      .send({ records: [{ village_code: '2', household_code: '8', construction_era: 0 }] })
      .expect(200);

    const imageInput = {
      image_name: 'floor-plan.png',
      image_mime: 'image/png',
      image_base64: Buffer.from('later-png-data').toString('base64'),
      width_px: 800,
      height_px: 600,
    };
    const attached = await request(app)
      .post('/api/projects/rural_002_house_0008/reference')
      .send(imageInput)
      .expect(200);
    expect(attached.body.reference_image).toMatchObject({
      path: 'reference/original.png',
      mime_type: 'image/png',
      width_px: 800,
      height_px: 600,
    });
    expect(attached.body.metadata.revision).toBe(1);
    expect(attached.body.survey.construction_era).toBe('不确定');

    const image = await request(app)
      .get('/api/projects/rural_002_house_0008/files/reference/original.png')
      .expect(200);
    expect(image.body).toEqual(Buffer.from('later-png-data'));

    const calibrated = structuredClone(attached.body);
    calibrated.reference_calibration = {
      calibrated: true,
      point_a_image: { x: 0, y: 0 },
      point_b_image: { x: 100, y: 0 },
      real_distance_mm: 1000,
      mm_per_image_pixel: 10,
      calibrated_at: '2026-08-14T00:00:00.000Z',
    };
    await request(app)
      .put('/api/projects/rural_002_house_0008/autosave')
      .send({ ...calibrated, _clientRevision: 1 })
      .expect(200);

    const duplicate = await request(app)
      .post('/api/projects/rural_002_house_0008/reference')
      .send(imageInput)
      .expect(409);
    expect(duplicate.body.error.code).toBe('REFERENCE_ALREADY_EXISTS');

    const removed = await request(app)
      .delete('/api/projects/rural_002_house_0008/reference')
      .expect(200);
    expect(removed.body.reference_image).toMatchObject({
      path: '',
      mime_type: 'application/octet-stream',
      width_px: 0,
      height_px: 0,
    });
    expect(removed.body.reference_calibration).toBeUndefined();
    expect(removed.body.metadata.revision).toBe(3);
    await expect(
      fs.access(path.join(
        config.dataRoot,
        'rural_002_house_0008',
        'reference',
        'original.png',
      )),
    ).rejects.toThrow();
    const removedFiles = await fs.readdir(path.join(
      config.dataRoot,
      'rural_002_house_0008',
      'reference',
      '.removed',
    ));
    expect(removedFiles).toHaveLength(1);
    expect(removedFiles[0]).toMatch(/-r2-original\.png$/);

    const reattached = await request(app)
      .post('/api/projects/rural_002_house_0008/reference')
      .send(imageInput)
      .expect(200);
    expect(reattached.body.metadata.revision).toBe(4);
  });

  it('rejects unsupported images and traversal IDs', async () => {
    const app = await createApp(config);

    const imageError = await request(app)
      .post('/api/projects')
      .send({
        building_id: 'house_0001',
        image_name: 'sketch.gif',
        image_mime: 'image/gif',
        image_base64: Buffer.from('gif-data').toString('base64'),
        width_px: 100,
        height_px: 100,
      })
      .expect(400);
    expect(imageError.body.error.code).toBe('UNSUPPORTED_IMAGE');

    const pathError = await request(app)
      .get('/api/projects/%2E%2E%2Fescape')
      .expect(400);
    expect(pathError.body.error.code).toBe('INVALID_BUILDING_ID');
  });

  it('opens only the validated current project directory through the injected opener', async () => {
    const openedDirectories: string[] = [];
    config.folderOpener = async (directory) => { openedDirectories.push(directory); };
    const app = await createApp(config);
    await request(app)
      .post('/api/projects/surveys/bulk')
      .send({ records: [{ village_code: '3', household_code: '9' }] })
      .expect(200);

    await request(app)
      .post('/api/projects/rural_003_house_0009/open-folder')
      .expect(204);
    expect(openedDirectories).toEqual([
      path.join(config.dataRoot, 'rural_003_house_0009'),
    ]);

    await request(app)
      .post('/api/projects/missing/open-folder')
      .expect(404)
      .expect(({ body }) => {
        expect(body.error.code).toBe('BUILDING_NOT_FOUND');
      });
  });

  it('creates, updates, lists, and deletes application-level room templates', async () => {
    const app = await createApp(config);
    const created = await request(app)
      .post('/api/settings/room-functions')
      .send({ name: '火炕间', color: '#AABBCC' })
      .expect(201);
    expect(created.body).toMatchObject({ name: '火炕间', color: '#aabbcc' });
    expect(created.body.code).toMatch(/^custom_/);

    const listed = await request(app)
      .get('/api/settings/room-functions')
      .expect(200);
    expect(listed.body).toEqual([created.body]);

    const updated = await request(app)
      .put(`/api/settings/room-functions/${created.body.code}`)
      .send({ name: '冬季起居室', color: '#123456' })
      .expect(200);
    expect(updated.body).toEqual({
      code: created.body.code,
      name: '冬季起居室',
      color: '#123456',
    });

    await request(app)
      .delete(`/api/settings/room-functions/${created.body.code}`)
      .expect(200, { ok: true });
    await request(app).get('/api/settings/room-functions').expect(200, []);
    const projectList = await request(app).get('/api/projects').expect(200);
    expect(projectList.body).toEqual([]);
  });

  it('refreshes topology warnings and statistics during autosave', async () => {
    const app = await createApp(config);
    const created = await request(app)
      .post('/api/projects')
      .send({
        building_id: 'house_quality',
        image_name: 'sketch.png',
        image_mime: 'image/png',
        image_base64: Buffer.from('png-data').toString('base64'),
        width_px: 640,
        height_px: 480,
      })
      .expect(201);
    const document = created.body;
    document.survey = { village_code: '1', household_code: '1', bay_count: 4 };
    document.vertices = {
      a: { x_mm: 0, y_mm: 0 },
      b: { x_mm: 1000, y_mm: 0 },
    };
    document.walls = {
      wall: {
        start_vertex_id: 'a', end_vertex_id: 'b', wall_type: 'exterior',
        thickness_mm: 240, height_mm: 3000, material_type: 'brick',
      },
    };
    document.floors[0].wall_ids = ['wall'];

    const saved = await request(app)
      .put('/api/projects/house_quality/autosave')
      .send({ ...document, _clientRevision: 0 })
      .expect(200);
    expect(saved.body.structured_validation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'BAY_FACE_COUNT_MISMATCH',
          message_params: { bay_count: 4, face_count: 0 },
        }),
      ]),
    );
    expect(saved.body.statistics.validation_warning_count).toBeGreaterThan(0);
  });

  it('accepts atomic workflow commands and POST export with a revision header', async () => {
    const app = await createApp(config);
    const created = await request(app)
      .post('/api/projects')
      .send({
        building_id: 'house_0001',
        image_name: 'sketch.png',
        image_mime: 'image/png',
        image_base64: Buffer.from('png-data').toString('base64'),
        width_px: 640,
        height_px: 480,
      })
      .expect(201);
    const ready = {
      ...created.body,
      metadata: {
        ...created.body.metadata,
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

    const pending = await request(app)
      .post('/api/projects/house_0001/submit-review')
      .send({ document: ready, client_revision: 0 })
      .expect(200);
    const reviewed = await request(app)
      .post('/api/projects/house_0001/review')
      .send({
        document: pending.body,
        client_revision: 1,
        reviewer: 'reviewer',
      })
      .expect(200);
    const completed = await request(app)
      .post('/api/projects/house_0001/complete')
      .send({ document: reviewed.body, client_revision: 2 })
      .expect(200);

    const exported = await request(app)
      .post('/api/projects/house_0001/export')
      .send({
        document: completed.body,
        client_revision: 3,
        options: { scale: '1:200', scale_bar: true },
      })
      .buffer(true)
      .parse(binaryParser)
      .expect(200)
      .expect('content-type', /application\/zip/);

    expect(exported.headers['x-building-revision']).toBe('3');
    expect(exported.body.includes(Buffer.from('spatial_graph.json'))).toBe(true);
  });
});

function binaryParser(
  response: NodeJS.ReadableStream,
  callback: (error: Error | null, body?: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', (error: Error) => callback(error));
}
