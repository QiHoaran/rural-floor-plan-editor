// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
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

    await request(app).get('/api/projects').expect(200, []);

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

    expect(created.body.building_id).toBe('house_0001');

    const image = await request(app)
      .get('/api/projects/house_0001/files/reference/original.png')
      .expect(200);
    expect(image.body).toEqual(Buffer.from('png-data'));

    const listed = await request(app).get('/api/projects').expect(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].building_id).toBe('house_0001');

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
