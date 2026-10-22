/* Focused regression checks for funding, pack caps and delayed limit changes. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const unsupported=name=>{throw new Error(`Unexpected test dependency: ${name}`);};
function harness(initialRaw){
  let now=Date.parse('2026-10-18T12:00:00Z'),nextId=1;
  const timers=new Map(),storage=new Map(initialRaw?[["foil-workspace-v1",JSON.stringify(initialRaw)]]:[]);
  class Clock extends Date{constructor(value){super(value===undefined?now:value);}static now(){return now;}}
  const context={exports:{},Date:Clock,crypto:webcrypto,window:{},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},setTimeout:(fn,delay)=>{const id=nextId++;timers.set(id,{at:now+delay,fn});return id;},clearTimeout:id=>timers.delete(id),require:name=>name==='react'?{useSyncExternalStore:(_sub,get)=>get()}:name==='./foil-protocol'?{TIN_DENOMINATIONS:[10,25,50,100,250,500,1000],regionAllowed:()=>({allowed:true})}:name==='./foil-live'?{useLive:()=>({})}:name==='@foil/client'?{mergeLimits:(a)=>a}:unsupported(name)};
  const source=fs.readFileSync(path.join(root,'src/lib/foil-workspace.ts'),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,context);
  const api=context.exports;api.useWorkspace();
  return {api,state:()=>api.useWorkspace(),advance:ms=>{now+=ms;for(const[id,t]of[...timers])if(t.at<=now){timers.delete(id);t.fn();}},now:()=>now};
}
let h=harness();
const before=h.state().balance;const tin=h.api.allocateTin('Round budget',50);
assert.equal(tin.productId,'tin-unassigned');assert.equal(tin.status,'Queued');assert.equal(h.state().balance,before-50);
assert.throws(()=>h.api.allocateTin('Unsupported',17),/supported tin size/);
h.api.updateLimits(10,20);h.api.allocateTin('Advance funding',500);h.api.assertRipAllowed(10);assert.throws(()=>h.api.assertRipAllowed(25),/spending limits/);
h=harness();h.api.updateLimits(100,2000);assert.equal(h.state().dailyLimit,100);assert.equal(h.state().weeklyLimit,1000);assert.ok(h.state().pendingLimits);h.advance(86400000);assert.equal(h.state().weeklyLimit,2000);assert.equal(h.state().pendingLimits,null);
h=harness();h.api.updateLimits(500,600);assert.equal(h.state().dailyLimit,250);assert.equal(h.state().weeklyLimit,600);h.advance(86400000);assert.equal(h.state().dailyLimit,500);assert.equal(h.state().weeklyLimit,600);
h=harness();h.api.startCoolOff();assert.throws(()=>h.api.assertRipAllowed(10),/cool-off/);h.api.allocateTin('Plan during cool-off',10);h.advance(7*86400000);h.api.assertRipAllowed(10);
h=harness();const state=h.state();const entry={id:'confirmed',title:'Pack spent',detail:'Test fixture',amount:-240,at:new Date(h.now()).toISOString(),kind:'pack-spend'};assert.throws(()=>h.api.assertRipAllowed(25,{...state,activity:[entry]}),/spending limits/);h.api.assertRipAllowed(25,{...state,activity:[{...entry,kind:'tin-funding',amount:-500}]});
const catalogContext={exports:{},require:name=>name==='./foil-premium-catalog.json'?JSON.parse(fs.readFileSync(path.join(root,'src/data/foil-premium-catalog.json'),'utf8')):unsupported(name)};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/data/foil-catalog.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,catalogContext);
assert.equal(catalogContext.exports.getCollectible('unknown-token').image,'/assets/foil/unavailable-card.svg');
assert.equal(catalogContext.exports.getCollectible('unknown-token').id,'unknown-token');
h=harness({version:1,balance:100,tins:[{id:'old-ready',name:'Old choice',productId:'vault-02',amount:17,status:'Ready',shared:false,created:'2026-10-01T00:00:00Z'},{id:'old-kept',name:'Kept card',productId:'vault-03',amount:50,status:'Kept',shared:false,created:'2026-10-01T00:00:00Z'}],gifts:[],activity:[]});assert.equal(h.state().tins[0].productId,'tin-unassigned');assert.equal(h.state().tins[0].referenceProductId,'vault-02');assert.equal(h.state().tins[0].amount,17);assert.equal(h.state().tins[0].requiresFundingReview,true);assert.equal(h.state().tins[1].productId,'vault-03');
console.log('PASS: supported tin sizes, unassigned pulls, funding/spend separation, mixed cap edits, live delayed activation, cool-off, confirmed pack-spend accounting unknown-asset recovery and legacy funding-plan migration.');

const art=catalogContext.exports.getTinCollectible;
assert.equal(art({productId:'tin-unassigned',referenceProductId:'pack-01'}).image,'/assets/foil/catalog/pack-01.png');
assert.equal(art({productId:'tin-unassigned',referenceProductId:'pack-01'}).kind,'tin');
assert.equal(art({productId:'tin-unassigned'}).image,'/assets/foil/fresh-tin.svg');
assert.equal(art({productId:'vault-01',referenceProductId:'pack-01'}).id,'vault-01');
assert.equal(art({productId:'tin-unassigned',referenceProductId:'unknown-token'}).image,'/assets/foil/fresh-tin.svg');
h=harness({version:1,balance:100,tins:[{id:'tin-002',name:'Ready pack tin',productId:'tin-unassigned',amount:25,status:'Ready',shared:false,created:'2026-10-15T14:30:00Z'},{id:'custom-plan',name:'Custom plan',productId:'tin-unassigned',amount:25,status:'Queued',shared:false,created:'2026-10-18T00:00:00Z'}],gifts:[],activity:[]});
assert.equal(h.state().tins[0].referenceProductId,'pack-01');
assert.equal(h.state().tins[0].productId,'tin-unassigned');
assert.equal(h.state().tins[1].referenceProductId,undefined);
assert.equal(art(h.state().tins[0]).image,'/assets/foil/catalog/pack-01.png');
console.log('PASS: preserved pack reference artwork and starter repair, with funding status/custom records unchanged.');
