import { spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { ServiceError } from '../errors.js';
import { atomicWriteJson } from '../atomicWrite.js';

export interface RunnerRequest {
  source_path: string; output_dir: string; formats: string[];
  source_sha256: string; source_revision: number;
}
export interface RunnerEvent { format: string; status: 'succeeded'|'quarantined'|'failed'; message?: string }
export interface ConversionRunner {
  check(): Promise<{ available: boolean; reason?: string }>;
  run(request: RunnerRequest, event: (result: RunnerEvent) => Promise<void>): Promise<void>;
}
export class PythonRunner implements ConversionRunner {
  private readonly directory: string;
  private readonly executable: string;
  constructor(projectRoot: string, executable?: string) {
    this.directory=path.join(projectRoot,'scripts','preprocess_rural_data');
    this.executable=executable ?? path.join(this.directory,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  }
  async check(): Promise<{available:boolean;reason?:string}> {
    try { await this.execute(['--check'],async()=>{},30_000); return {available:true}; }
    catch (error) { return {available:false, reason:`Python 转换环境不可用，请在 scripts/preprocess_rural_data 执行 uv sync --all-packages --all-groups --locked。${error instanceof Error?error.message:''}`}; }
  }
  async run(request: RunnerRequest, event: (result: RunnerEvent)=>Promise<void>): Promise<void> {
    const filename=path.join(path.dirname(request.source_path),'request.json');
    await atomicWriteJson(filename,request);
    await this.execute(['--request',filename],event,30*60_000);
  }
  private execute(args: string[], event: (result: RunnerEvent)=>Promise<void>, timeout: number): Promise<void> {
    return new Promise((resolve,reject)=>{
      const child=spawn(this.executable,[path.join(this.directory,'adapter.py'),...args],{cwd:this.directory,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONUNBUFFERED:'1'}});
      let errors='', events=Promise.resolve(), eventError: unknown;
      const timer=setTimeout(()=>{ child.kill(); eventError=new Error('转换进程超时'); },timeout);
      child.stderr.on('data',(data:Buffer)=>{ errors=(errors+data.toString('utf8')).slice(-8000); });
      const lines=createInterface({input:child.stdout});
      lines.on('line',(line)=>{
        if(!line.trim()) return;
        try {
          const parsed=JSON.parse(line) as RunnerEvent;
          if(parsed.format) {
            if(!['succeeded','quarantined','failed'].includes(parsed.status)) throw new Error('无效转换进度');
            events=events.then(()=>event(parsed)).catch(error=>{eventError=error; child.kill();});
          }
        } catch(error) { eventError=error; child.kill(); }
      });
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('close',code=>{
        clearTimeout(timer); lines.close();
        void events.then(()=>{
          if(eventError) reject(eventError);
          else if(code!==0) reject(new ServiceError(errors || `转换进程退出 (${code})`,500,'CONVERTER_PROCESS_FAILED'));
          else resolve();
        });
      });
    });
  }
}
