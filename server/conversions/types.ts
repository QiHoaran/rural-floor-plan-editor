export interface FormatDescriptor {
  // Mirrors adapter.py's needs_cleaned: when true the converter runs the shared cleaner
  // first, and the editor marks the format with a broom icon.
  id: string; label: string; directory: string; version: string; usesClean: boolean;
}
export const FORMATS: FormatDescriptor[] = [
  {id:'graph', label:'Graph', directory:'Graph', version:'1.0.0', usesClean:true},
  {id:'image', label:'Image', directory:'Image', version:'1.0.0', usesClean:true},
  {id:'cad', label:'CAD', directory:'CAD', version:'1.0.0', usesClean:true},
  {id:'embodied', label:'Embodied', directory:'Embodied', version:'1.0.0', usesClean:false},
  {id:'housegan', label:'HouseGAN', directory:'HouseGAN', version:'1.0.0', usesClean:true},
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
