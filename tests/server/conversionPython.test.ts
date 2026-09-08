// @vitest-environment node
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { ProjectService } from '../../server/projectService.ts';
import { ConversionService } from '../../server/conversions/service.ts';
import { createEmptyBuilding } from '../../src/editor/domain/buildingDocument.ts';

const python=path.resolve('scripts/conversion/.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
it.skipIf(!existsSync(python))('integrates Node snapshot, real Python five-format worker, verified publication and deterministic overwrite',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rural-python-integration-'));
  try {
    const document=createEmptyBuilding('rural_001_house_0001','reference/original.png');
    document.metadata.status='complete';document.workflow.status='complete';
    document.reference_image={...document.reference_image,mime_type:'image/png',width_px:100,height_px:100};
    document.reference_calibration={calibrated:true,point_a_image:{x:0,y:0},point_b_image:{x:100,y:0},real_distance_mm:1000,mm_per_image_pixel:10,calibrated_at:document.metadata.created_at};
    document.vertices={a:{x_mm:100,y_mm:200},b:{x_mm:4100,y_mm:200},c:{x_mm:4100,y_mm:3200},d:{x_mm:100,y_mm:3200}};
    for(const [id,start,end] of [['0','a','b'],['1','b','c'],['2','c','d'],['3','d','a']])document.walls[id]={start_vertex_id:start,end_vertex_id:end,wall_type:'exterior',thickness_mm:200,height_mm:2800,material_type:'brick'};
    document.faces={room:{boundary_vertex_ids:['a','b','c','d'],area_mm2:12000000,function_code:'bedroom',display_name:'卧室',color:'#eeeeee',local_name:''}};
    document.wall_elements={door:{element_type:'exterior_door',host_wall_id:'0',offset_from_start_mm:1000,width_mm:901,height_mm:2100,sill_height_mm:0,status:'valid'}};
    document.relations=[{relation_type:'opening',wall_element_id:'door',from_face_id:'room',to:{kind:'outside'},channels:{people:true,air:true,light:true}}];
    document.floors[0].wall_ids=Object.keys(document.walls);document.floors[0].face_ids=['room'];
    const dataRoot=path.join(root,'data');const source=path.join(dataRoot,document.building_id,'building.json');
    await fs.mkdir(path.dirname(source),{recursive:true});const bytes=JSON.stringify(document);await fs.writeFile(source,bytes);
    const service=new ConversionService({projectRoot:process.cwd(),dataRoot,port:0,development:false},new ProjectService(dataRoot));
    const input={projects:[{buildingId:document.building_id,revision:0}],formats:['graph','image','cad','embodied','housegan'],outputRoot:path.join(root,'中文 output'),overwrite:false};
    expect((await service.formats()).formats).toContainEqual(expect.objectContaining({id:'housegan',label:'HouseGAN',directory:'HouseGAN',available:true}));
    const job=await service.submit(input);await service.idle();
    expect(service.get(job.id).items).toEqual(input.formats.map(format=>({buildingId:document.building_id,format,status:'succeeded'})));
    const hashes=new Map<string,string>();
    const originals=new Map<string,Buffer>();
    for(const directory of ['Graph','Image','CAD','Embodied','HouseGAN']) {
      const dir=path.join(input.outputRoot,document.building_id,directory);
      const manifest=JSON.parse(await fs.readFile(path.join(dir,'conversion.json'),'utf8'));
      expect(manifest.source_sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      for(const artifact of manifest.artifacts) {
        const hash=createHash('sha256').update(await fs.readFile(path.join(dir,artifact.path))).digest('hex');
        expect(hash).toBe(artifact.sha256);hashes.set(path.join(dir,artifact.path),hash);
        originals.set(path.join(dir,artifact.path),await fs.readFile(path.join(dir,artifact.path)));
      }
    }
    const embodied=path.join(input.outputRoot,document.building_id,'Embodied');
    expect(await fs.readFile(path.join(embodied,'canonical_floorplan.json'),'utf8')).toBe(await fs.readFile(path.join(embodied,'reconstructed_floorplan.json'),'utf8'));
    const image=await fs.readFile(path.join(input.outputRoot,document.building_id,'Image','instance.png'));
    expect(image.readUInt32BE(16)).toBe(256);expect(image.readUInt32BE(20)).toBe(256);expect(image[24]).toBe(16);
    const housegan=JSON.parse(await fs.readFile(path.join(input.outputRoot,document.building_id,'HouseGAN','housegan.json'),'utf8'));
    expect(housegan.room_type).toEqual([3,15]);
    expect(housegan.ed_rm.some((ids:number[])=>ids.includes(0)&&ids.includes(1))).toBe(true);
    const solo=await service.submit({...input,formats:['housegan'],outputRoot:path.join(root,'housegan-only')});await service.idle();
    expect(service.get(solo.id).items).toEqual([{buildingId:document.building_id,format:'housegan',status:'succeeded'}]);
    const second=await service.submit({...input,overwrite:true});await service.idle();
    expect(service.get(second.id).items.every(item=>item.status==='succeeded')).toBe(true);
    for(const [file,hash] of hashes) {
      const actual=await fs.readFile(file);
      const before=originals.get(file)!.toString('utf8').split('\n');
      const after=actual.toString('utf8').split('\n');
      const differences=before.flatMap((line,index)=>line===after[index]?[]:[`${index}: ${line} => ${after[index]}`]).slice(0,15).join('\n');
      expect(createHash('sha256').update(actual).digest('hex'),`${file}\n${differences}`).toBe(hash);
    }
    expect(await fs.readFile(source,'utf8')).toBe(bytes);
  } finally {await fs.rm(root,{recursive:true,force:true});}
},60_000);
