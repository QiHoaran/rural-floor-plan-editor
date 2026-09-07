import { Router } from 'express';
import type { ConversionService } from '../conversions/service.js';

export function createConversionRouter(service:ConversionService):Router {
  const router=Router();
  router.get('/formats',async(_req,res)=>{res.json(await service.formats());});
  router.post('/recover',async(req,res)=>{res.json(await service.recover(req.body?.id,req.body?.outputRoot));});
  router.post('/',async(req,res)=>{res.status(202).json(await service.submit(req.body));});
  router.get('/:id',(req,res)=>{res.json(service.get(String(req.params.id)));});
  router.post('/:id/open',async(req,res)=>{await service.open(String(req.params.id));res.status(204).end();});
  return router;
}
