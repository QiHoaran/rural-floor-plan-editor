import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ServerConfig } from '../config.js';
import type { ProjectService } from '../projectService.js';
import { ServiceError } from '../errors.js';
import { atomicWriteJson } from '../atomicWrite.js';
import { validateBuildingId } from '../pathSafety.js';
import { openLocalDirectory } from '../openLocalDirectory.js';
import { OutputPaths } from './paths.js';
import { PythonRunner, type ConversionRunner, type RunnerEvent } from './runner.js';
import { FORMATS, type ConversionInput, type ConversionJob, type ConversionItem, type FormatDescriptor } from './types.js';

const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function message(error: unknown): string { return error instanceof ServiceError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : '转换失败'; }
async function exists(file:string):Promise<boolean> { try {await fs.lstat(file);return true;} catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;} }

export class ConversionService {
  private readonly jobs=new Map<string,ConversionJob>();
  private tail:Promise<void>=Promise.resolve();
  private readonly paths:OutputPaths;
  private readonly runner:ConversionRunner;
  constructor(private readonly config:ServerConfig, private readonly projects:ProjectService, runner?:ConversionRunner) {
    this.paths=new OutputPaths([config.dataRoot,path.join(config.projectRoot,'data')]);
    this.runner=runner ?? new PythonRunner(config.projectRoot,config.conversionPython);
  }
  async formats() { const availability=await this.runner.check(); return {formats:FORMATS.map(format=>({...format,...availability}))}; }
  async submit(value:unknown):Promise<ConversionJob> {
    const input=this.validate(value);
    const outputRoot=await this.paths.root(input.outputRoot);
    const available=await this.runner.check();
    if(!available.available) throw new ServiceError(available.reason ?? '转换环境不可用',503,'CONVERSION_ENVIRONMENT_UNAVAILABLE');
    await this.paths.root(outputRoot,true);
    const job:ConversionJob={id:randomUUID(),ownerPid:process.pid,status:'queued',outputRoot,items:input.projects.flatMap(project=>input.formats.map(format=>({buildingId:project.buildingId,format,status:'queued'})))};
    const directory=await this.jobDirectory(job);
    await fs.mkdir(directory,{recursive:true});
    await this.persist(job);
    this.jobs.set(job.id,job);
    this.tail=this.tail.then(()=>this.run(job,input)).catch(async(error)=>{
      job.status='interrupted';job.message=message(error);
      for(const item of job.items) if(['queued','running'].includes(item.status)){item.status='failed';item.message=job.message;}
      try{await this.persist(job);}catch{/* Keep status accessible even when the output volume goes offline. */}
    });
    return structuredClone(job);
  }
  get(id:string):ConversionJob {
    const job=this.jobs.get(id);
    if(!job) throw new ServiceError('转换任务不存在；服务可能已重启，可从输出目录恢复报告',404,'CONVERSION_JOB_NOT_FOUND');
    return structuredClone(job);
  }
  async idle():Promise<void> { await this.tail; }
  async open(id:string):Promise<void> { const job=this.get(id); await (this.config.folderOpener ?? openLocalDirectory)(await this.paths.root(job.outputRoot)); }
  async recover(id:unknown,outputRoot:unknown):Promise<ConversionJob> {
    if(typeof id!=='string'||!UUID.test(id)||typeof outputRoot!=='string') throw new ServiceError('任务信息无效',400,'INVALID_CONVERSION_JOB');
    const local=this.jobs.get(id);
    if(local && ['queued','running'].includes(local.status)) return this.get(id);
    const root=await this.paths.root(outputRoot);
    const filename=await this.paths.child(root,'.conversions',id,'job.json');
    let job:ConversionJob;
    try {job=JSON.parse(await fs.readFile(filename,'utf8'));}
    catch {throw new ServiceError('无法读取转换任务报告',404,'CONVERSION_JOB_NOT_FOUND');}
    if(job.id!==id||job.outputRoot!==root||!Array.isArray(job.items)||!['queued','running','completed','interrupted'].includes(job.status)) throw new ServiceError('任务报告无效',422,'INVALID_CONVERSION_JOB');
    for(const item of job.items) {
      if(typeof item.buildingId!=='string'||!FORMATS.some(f=>f.id===item.format)) throw new ServiceError('任务报告无效',422,'INVALID_CONVERSION_JOB');
      validateBuildingId(item.buildingId);
    }
    const unfinished=['queued','running'].includes(job.status);
    if(unfinished && job.ownerPid && this.alive(job.ownerPid)) throw new ServiceError('该转换任务仍在另一个服务进程中运行',409,'CONVERSION_BUSY');
    {
      // Recover only this job's locks/backups; never inspect or delete arbitrary paths from JSON.
      for(const item of job.items) {
        const format=FORMATS.find(f=>f.id===item.format)!;
        const lock=await this.paths.child(root,'.conversions','locks',`${item.buildingId}-${format.id}.json`);
        if(await exists(lock)) {
          const owner=JSON.parse(await fs.readFile(lock,'utf8')) as {pid:number;jobId:string};
          if(owner.jobId!==id) continue;
          if(unfinished && this.alive(owner.pid)) throw new ServiceError('该转换任务仍在另一个服务进程中运行',409,'CONVERSION_BUSY');
          const backup=await this.paths.child(root,'.conversions',id,`backup-${item.buildingId}-${format.id}`);
          const destination=await this.paths.child(root,item.buildingId,format.directory);
          if(await exists(backup) && !await exists(destination)) await fs.rename(backup,destination);
          await fs.unlink(lock);
        }
      }
      if(unfinished) {
        job.status='interrupted';job.message='服务重启，未完成的转换已中断，请重新提交。';
        for(const item of job.items) if(['queued','running'].includes(item.status)){item.status='failed';item.message=job.message;}
      }
      await this.persist(job);
    }
    this.jobs.set(id,job); return structuredClone(job);
  }
  private alive(pid:number):boolean { if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';} }
  private validate(value:unknown):ConversionInput {
    const bad=():never=>{throw new ServiceError('请选择项目、格式并填写输出目录',400,'INVALID_CONVERSION_REQUEST');};
    if(!value||typeof value!=='object')return bad();
    const input=value as ConversionInput;
    if(!Array.isArray(input.projects)||input.projects.length===0||input.projects.length>2000||!Array.isArray(input.formats)||!input.formats.length||typeof input.outputRoot!=='string'||typeof input.overwrite!=='boolean')return bad();
    const seen=new Set<string>();
    for(const project of input.projects) {
      if(!project||typeof project.buildingId!=='string'||!Number.isInteger(project.revision)||project.revision<0)return bad();
      const id=validateBuildingId(project.buildingId);
      if(id!==project.buildingId||seen.has(id))return bad();seen.add(id);
    }
    if(new Set(input.formats).size!==input.formats.length||input.formats.some(id=>!FORMATS.some(f=>f.id===id)))return bad();
    return structuredClone(input);
  }
  private async jobDirectory(job:ConversionJob):Promise<string> {return this.paths.child(job.outputRoot,'.conversions',job.id);}
  private async persist(job:ConversionJob):Promise<void> {await atomicWriteJson(await this.paths.child(job.outputRoot,'.conversions',job.id,'job.json'),job);}
  private async run(job:ConversionJob,input:ConversionInput):Promise<void> {
    job.status='running';await this.persist(job);
    for(const project of input.projects) {
      const items=job.items.filter(item=>item.buildingId===project.buildingId);
      try{await this.runBuilding(job,project,items,input.overwrite);}
      catch(error) {
        job.message=message(error);
        for(const item of items) if(['queued','running'].includes(item.status)) {
          item.status=error instanceof ServiceError&&error.code==='PROJECT_NOT_COMPLETE'?'skipped':'failed';item.message=message(error);
        }
      }
      await this.persist(job);
    }
    job.status='completed';await this.persist(job);
  }
  private async runBuilding(job:ConversionJob,project:ConversionInput['projects'][number],items:ConversionItem[],overwrite:boolean):Promise<void> {
    const snapshot=await this.projects.withConversionSnapshot(project.buildingId,project.revision,async value=>value);
    const releases:Array<()=>Promise<void>>=[];
    let work:string|undefined;
    try {
      for(const item of items) {
        const format=FORMATS.find(f=>f.id===item.format)!;
        try {
          const destination=await this.paths.child(job.outputRoot,project.buildingId,format.directory);
          releases.push(await this.lock(job,project.buildingId,format.id));
          if(await exists(destination)&&!overwrite){item.status='skipped';item.message='输出目录已存在';continue;}
          if(await exists(destination)&&!(await fs.stat(destination)).isDirectory())throw new Error('目标格式路径不是目录');
          item.status='running';
        } catch(error){item.status='failed';item.message=message(error);}
      }
      await this.persist(job);
      const active=items.filter(i=>i.status==='running');
      if(!active.length)return;
      work=await this.paths.child(job.outputRoot,'.conversions',job.id,`work-${project.buildingId}`);
      await fs.mkdir(work);
      const sourcePath=await this.paths.child(job.outputRoot,path.relative(job.outputRoot,path.join(work,'building.json')));
      await fs.writeFile(sourcePath,snapshot.bytes,{flag:'wx'});
      const staging=path.join(work,'artifacts');await fs.mkdir(staging);
      const seen=new Set<string>();
      await this.runner.run({source_path:sourcePath,output_dir:staging,formats:active.map(i=>i.format),source_sha256:snapshot.sha256,source_revision:snapshot.revision},async(event:RunnerEvent)=>{
        const item=active.find(i=>i.format===event.format);
        if(!item||seen.has(event.format))throw new Error('转换器返回重复或未请求的格式');
        seen.add(event.format);
        const format=FORMATS.find(f=>f.id===item.format)!;
        const generated=await this.paths.child(job.outputRoot,path.relative(job.outputRoot,path.join(staging,format.directory)));
        try {
          if(event.status==='succeeded') {
            await this.projects.withConversionSnapshot(project.buildingId,project.revision,async()=>{
              await this.publish(job,project.buildingId,format,generated,overwrite);
            },snapshot.sha256);
            item.status='succeeded';
          } else if(event.status==='quarantined') {
            const report=await this.paths.child(job.outputRoot,'.conversions',job.id,`quarantine-${project.buildingId}-${format.id}`);
            if(await exists(generated))await fs.rename(generated,report);
            item.status='quarantined';item.message=event.message ?? '源数据未通过该格式校验，详情见任务报告目录';
          } else {item.status='failed';item.message=event.message ?? '格式转换失败';}
        }catch(error){item.status='failed';item.message=message(error);}
        await this.persist(job);
      });
      for(const item of active)if(item.status==='running'){item.status='failed';item.message='转换器未返回该格式结果';}
    } finally {
      // Work contains only snapshots and unpublished data. Backups are kept separately.
      await this.cleanup(job,work,releases);
    }
  }
  private async cleanup(job:ConversionJob,work:string|undefined,releases:Array<()=>Promise<void>>):Promise<void> {
    const results=await Promise.allSettled([
      work ? this.paths.remove(job.outputRoot,work) : Promise.resolve(),
      ...releases.map(release=>release()),
    ]);
    const errors=results.flatMap(result=>result.status==='rejected'?[message(result.reason)]:[]);
    if(errors.length)throw new Error(errors.join('; '));
  }
  private async lock(job:ConversionJob,buildingId:string,format:string):Promise<()=>Promise<void>> {
    const file=await this.paths.child(job.outputRoot,'.conversions','locks',`${buildingId}-${format}.json`);
    await fs.mkdir(path.dirname(file),{recursive:true});
    let handle;
    try{handle=await fs.open(file,'wx');}
    catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      const owner=JSON.parse(await fs.readFile(file,'utf8')) as {pid:number;jobId:string};
      const previous=this.jobs.get(owner.jobId);
      if(!this.alive(owner.pid) || (previous && !['queued','running'].includes(previous.status))) {
        await this.recover(owner.jobId,job.outputRoot);
        try{handle=await fs.open(file,'wx');}catch{throw new ServiceError('目标输出锁未释放',409,'CONVERSION_BUSY');}
      }else throw new ServiceError('目标正在转换，或上次任务中断；请先恢复该任务报告',409,'CONVERSION_BUSY');
    }
    try{await handle.writeFile(JSON.stringify({pid:process.pid,jobId:job.id}));}finally{await handle.close();}
    return async()=>{
      await this.paths.child(job.outputRoot,path.relative(job.outputRoot,file));
      const backup=await this.paths.child(job.outputRoot,'.conversions',job.id,`backup-${buildingId}-${format}`);
      // Preserve ownership if rollback or backup cleanup failed. recover() can safely restore it.
      if(await exists(backup))return;
      await fs.unlink(file);
    };
  }
  private async publish(job:ConversionJob,buildingId:string,format:FormatDescriptor,generated:string,overwrite:boolean):Promise<void> {
    const destination=await this.paths.child(job.outputRoot,buildingId,format.directory);
    await this.paths.child(job.outputRoot,path.relative(job.outputRoot,generated));
    if(!(await fs.stat(generated)).isDirectory())throw new Error('转换输出目录不存在');
    await fs.mkdir(path.dirname(destination),{recursive:true});
    const backup=await this.paths.child(job.outputRoot,'.conversions',job.id,`backup-${buildingId}-${format.id}`);
    const hasPrevious=await exists(destination);
    if(hasPrevious&&!overwrite)throw new ServiceError('目标已存在',409,'OUTPUT_EXISTS');
    if(hasPrevious)await fs.rename(destination,backup);
    try{await fs.rename(generated,destination);}
    catch(error){if(hasPrevious)await fs.rename(backup,destination);throw error;}
    if(hasPrevious)await this.paths.remove(job.outputRoot,backup);
  }
}
