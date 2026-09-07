export interface FormatDescriptor {
  id: string; label: string; directory: string; version: string;
}
export const FORMATS: FormatDescriptor[] = [
  {id:'graph', label:'Graph', directory:'Graph', version:'1.0.0'},
  {id:'image', label:'Image', directory:'Image', version:'1.0.0'},
  {id:'cad', label:'CAD', directory:'CAD', version:'1.0.0'},
  {id:'embodied_v2', label:'Embodied v2', directory:'Embodied', version:'2.0.0'},
];
export interface ConversionInput {
  projects: {buildingId: string; revision: number}[];
  formats: string[]; outputRoot: string; overwrite: boolean;
}
export type ItemStatus = 'queued' | 'running' | 'succeeded' | 'skipped' | 'quarantined' | 'failed';
export interface ConversionItem { buildingId: string; format: string; status: ItemStatus; message?: string }
export interface ConversionJob {
  id: string; status: 'queued'|'running'|'completed'|'interrupted';
  outputRoot: string; items: ConversionItem[]; message?: string; ownerPid?: number;
}
