// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConversionService } from '../../server/conversions/service.ts';
import { ProjectService } from '../../server/projectService.ts';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';
import type { ConversionRunner } from '../../server/conversions/runner.ts';
import express from 'express';
import request from 'supertest';
import { createConversionRouter } from '../../server/routes/conversions.ts';
import { ServiceError } from '../../server/errors.ts';

let root: string, output: string, projects: ProjectService;
let source: ReturnType<typeof createEmptyBuilding>;
let runner: ConversionRunner;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rural-conversion-'));
  output = path.join(root, '导出 data sets');
  projects = new ProjectService(path.join(root, 'data'));
  source = createEmptyBuilding('rural_001_house_0001', 'reference/original.png');
  source.reference_image.mime_type = 'image/png';
  source.reference_image.width_px = 100; source.reference_image.height_px = 100;
  source.metadata.status = 'complete'; source.workflow.status = 'complete';
  source.reference_calibration = { calibrated: true, point_a_image: {x:0,y:0}, point_b_image:{x:100,y:0}, real_distance_mm:1000, mm_per_image_pixel:10, calibrated_at:source.metadata.created_at };
  await fs.mkdir(path.join(root, 'data', source.building_id), {recursive:true});
  await saveSource();
  runner = {
    check: async () => ({ available: true }),
    run: async (request, event) => {
      for (const format of request.formats) {
        const dir = path.join(request.output_dir, format === 'graph' ? 'Graph' : 'Embodied');
        await fs.mkdir(dir); await fs.writeFile(path.join(dir, 'result.json'), '{}');
        await event({ format, status: 'succeeded' });
      }
    },
  };
});
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, {recursive:true,force:true}); });
async function saveSource() { await fs.writeFile(path.join(root,'data',source.building_id,'building.json'), JSON.stringify(source)); }
function service() { return new ConversionService({projectRoot:root,dataRoot:path.join(root,'data'),port:0,development:false}, projects, runner); }
function input(overwrite=false) { return {projects:[{buildingId:source.building_id,revision:0}],formats:['graph'],outputRoot:output,overwrite}; }
async function finished(s: ConversionService, id: string) { await s.idle(); return s.get(id); }

it('publishes outside data without changing the source, skips existing and replaces only on request', async () => {
  const s=service(); const before=await fs.readFile(path.join(root,'data',source.building_id,'building.json'));
  const first=await finished(s,(await s.submit(input())).id);
  expect(first.items[0].status).toBe('succeeded');
  const result=path.join(output,source.building_id,'Graph','result.json');
  await fs.writeFile(result,'old');
  expect((await finished(s,(await s.submit(input())).id)).items[0].status).toBe('skipped');
  expect(await fs.readFile(result,'utf8')).toBe('old');
  expect((await finished(s,(await s.submit(input(true))).id)).items[0].status).toBe('succeeded');
  expect(await fs.readFile(result,'utf8')).toBe('{}');
  expect(await fs.readFile(path.join(root,'data',source.building_id,'building.json'))).toEqual(before);
});
it('rejects relative paths and data roots including junction aliases', async () => {
  const s=service();
  for(const outputRoot of ['relative',path.join(root,'data','exports')]) await expect(s.submit({...input(),outputRoot})).rejects.toMatchObject({code:'UNSAFE_OUTPUT_PATH'});
  const alias=path.join(root,'alias'); await fs.symlink(path.join(root,'data'),alias,process.platform==='win32'?'junction':'dir');
  await expect(s.submit({...input(),outputRoot:path.join(alias,'exports')})).rejects.toMatchObject({code:'UNSAFE_OUTPUT_PATH'});
});
it('does not traverse a building directory junction into data', async () => {
  await fs.mkdir(output); await fs.symlink(path.join(root,'data'),path.join(output,source.building_id),process.platform==='win32'?'junction':'dir');
  const s=service(); expect((await finished(s,(await s.submit(input())).id)).items[0].status).toBe('failed');
  await expect(fs.stat(path.join(root,'data','Graph'))).rejects.toThrow();
});
it('skips unfinished projects and rejects revision conflicts and missing formal files', async () => {
  const s=service(); source.workflow.status='draft'; await saveSource();
  expect((await finished(s,(await s.submit(input())).id)).items[0].status).toBe('skipped');
  source.workflow.status='complete'; source.metadata.revision=1; await saveSource();
  expect((await finished(s,(await s.submit(input())).id)).items[0]).toMatchObject({status:'failed',message:expect.stringContaining('REVISION_CONFLICT')});
  await fs.unlink(path.join(root,'data',source.building_id,'building.json'));
  expect((await finished(s,(await s.submit(input())).id)).items[0].status).toBe('failed');
});
it('rejects a newer reopened draft even if old complete building.json remains', async () => {
  const draft=structuredClone(source); draft.workflow.status='draft'; draft.metadata.revision=1;
  const dir=path.join(root,'data',source.building_id,'draft'); await fs.mkdir(dir);
  await fs.writeFile(path.join(dir,'building.autosave.json'),JSON.stringify(draft));
  const s=service(); expect((await finished(s,(await s.submit(input())).id)).items[0].status).toBe('skipped');
});
it('rechecks source before publication and retains old results on failure', async () => {
  const s=service(); await finished(s,(await s.submit(input())).id);
  runner.run=async (request,event) => {
    await fs.mkdir(path.join(request.output_dir,'Graph')); await fs.writeFile(path.join(request.output_dir,'Graph','result.json'),'new');
    source.metadata.revision++; await saveSource(); await event({format:'graph',status:'succeeded'});
  };
  expect((await finished(s,(await s.submit(input(true))).id)).items[0].status).toBe('failed');
  expect(await fs.readFile(path.join(output,source.building_id,'Graph','result.json'),'utf8')).toBe('{}');
});
it('reports quarantine independently and never publishes its partial directory', async () => {
  const normal=runner.run;
  runner.run=async(req,event)=>{
    await normal({...req,formats:['graph']},event);
    await fs.mkdir(path.join(req.output_dir,'Embodied')); await fs.writeFile(path.join(req.output_dir,'Embodied','quarantine_report.json'),'{}');
    await event({format:'embodied_v2',status:'quarantined',message:'UNSUPPORTED_GEOMETRY'});
  };
  const s=service(); const job=await finished(s,(await s.submit({...input(),formats:['graph','embodied_v2']})).id);
  expect(job.items.map(i=>i.status)).toEqual(['succeeded','quarantined']);
  await expect(fs.stat(path.join(output,source.building_id,'Embodied'))).rejects.toThrow();
});
it('recovers an unfinished persisted job as interrupted without restarting it', async()=>{
  const s=service(); const job=await finished(s,(await s.submit(input())).id);
  const report=path.join(output,'.conversions',job.id,'job.json');
  await fs.writeFile(report,JSON.stringify({...job,ownerPid:undefined,status:'running',items:job.items.map(i=>({...i,status:'running'}))}));
  expect((await service().recover(job.id,output))).toMatchObject({status:'interrupted',items:[{status:'failed'}]});
});
it('keeps the old directory when the converter fails or is quarantined during overwrite',async()=>{
  const s=service();await finished(s,(await s.submit(input())).id);
  runner.run=async()=>{throw new Error('worker died');};
  expect((await finished(s,(await s.submit(input(true))).id)).items[0].status).toBe('failed');
  expect(await fs.readFile(path.join(output,source.building_id,'Graph','result.json'),'utf8')).toBe('{}');
  runner.run=async(req,event)=>{await fs.mkdir(path.join(req.output_dir,'Graph'));await event({format:'graph',status:'quarantined'});};
  expect((await finished(s,(await s.submit(input(true))).id)).items[0].status).toBe('quarantined');
  expect(await fs.readFile(path.join(output,source.building_id,'Graph','result.json'),'utf8')).toBe('{}');
});
it('serializes duplicate requests so the second job skips instead of replacing',async()=>{
  const s=service();const [a,b]=await Promise.all([s.submit(input()),s.submit(input())]);await s.idle();
  expect([s.get(a.id).items[0].status,s.get(b.id).items[0].status].sort()).toEqual(['skipped','succeeded']);
});
it('exposes async job APIs, structured input errors and opening the registered output root',async()=>{
  const opened:string[]=[];
  const s=new ConversionService({projectRoot:root,dataRoot:path.join(root,'data'),port:0,development:false,folderOpener:async directory=>{opened.push(directory);}},projects,runner);
  const app=express();app.use(express.json());app.use('/api/conversions',createConversionRouter(s));
  app.use(((error:Error,_req:unknown,res:express.Response,_next:unknown)=>{res.status(error instanceof ServiceError?error.status:500).json({error:{message:error.message}});}) as express.ErrorRequestHandler);
  const formats=await request(app).get('/api/conversions/formats').expect(200);
  expect(formats.body.formats.map((f:{id:string})=>f.id)).toContain('embodied_v2');
  await request(app).post('/api/conversions').send({...input(),formats:['invalid']}).expect(400);
  const result=await request(app).post('/api/conversions').send(input()).expect(202);
  await s.idle(); const job=await request(app).get(`/api/conversions/${result.body.id}`).expect(200);
  expect(job.body.status).toBe('completed');
  await request(app).post(`/api/conversions/${result.body.id}/open`).expect(204);
  expect(opened).toEqual([output]);
});
it('rejects an unavailable Python environment without creating the output directory',async()=>{
  runner.check=async()=>({available:false,reason:'install environment'});
  await expect(service().submit(input())).rejects.toMatchObject({code:'CONVERSION_ENVIRONMENT_UNAVAILABLE'});
  await expect(fs.stat(output)).rejects.toThrow();
});
it('recovers completed jobs with failed lock cleanup and exposes the cleanup error',async()=>{
  const original=fs.unlink.bind(fs);
  const fail=vi.spyOn(fs,'unlink').mockImplementation(async file=>{if(String(file).includes(`${path.sep}locks${path.sep}`))throw new Error('lock cleanup failed');return original(file);});
  const s=service();const job=await finished(s,(await s.submit(input())).id);
  expect(job.message).toContain('lock cleanup failed');fail.mockRestore();
  await s.recover(job.id,output);
  expect((await finished(s,(await s.submit(input(true))).id)).items[0].status).toBe('succeeded');
});
it('restores the old result after publication and rollback both fail',async()=>{
  const s=service();await finished(s,(await s.submit(input())).id);
  const rename=fs.rename.bind(fs);const destination=path.join(output,source.building_id,'Graph');
  const fail=vi.spyOn(fs,'rename').mockImplementation(async(from,to)=>{if(String(to)===destination)throw new Error('volume offline');return rename(from,to);});
  const job=await finished(s,(await s.submit(input(true))).id);expect(job.items[0].status).toBe('failed');
  fail.mockRestore();await s.recover(job.id,output);
  expect(await fs.readFile(path.join(destination,'result.json'),'utf8')).toBe('{}');
});
it('does not interrupt a live queued job owned by another service instance',async()=>{
  const s=service();const job=await finished(s,(await s.submit(input())).id);
  await fs.writeFile(path.join(output,'.conversions',job.id,'job.json'),JSON.stringify({...job,status:'queued'}));
  await expect(service().recover(job.id,output)).rejects.toMatchObject({code:'CONVERSION_BUSY'});
});
