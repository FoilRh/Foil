"use client";
import {TIN_DENOMINATIONS,regionAllowed} from "./foil-protocol";
import { useSyncExternalStore } from "react";
import { useLive } from "./foil-live";
import { mergeLimits, type BackupData, type Wallet } from "@foil/client";

export interface Tin {id:string;name:string;productId:string;amount:number;status:"Kept"|"Ready"|"Queued";shared:boolean;created:string;referenceProductId?:string;requiresFundingReview?:boolean}
export interface Gift {id:string;name:string;amount:number;message:string;created:string;status:"Draft"|"Cancelled"}
export interface Activity {id:string;title:string;detail:string;amount:number;at:string;kind?:"pack-spend"|"tin-funding"}
export interface Workspace {version:1;balance:number;tins:Tin[];gifts:Gift[];activity:Activity[];handle:string;dailyLimit:number;weeklyLimit:number;coolOffUntil:string|null;pendingLimits:{daily:number;weekly:number;at:string}|null;region?:string|null}
const KEY="foil-workspace-v1";
const initial:Workspace={
  version:1,balance:0,handle:"",dailyLimit:250,weeklyLimit:1000,coolOffUntil:null,pendingLimits:null,tins:[],gifts:[],activity:[],
};
/** The example records earlier builds started every visitor with; dropped from saved workspaces on load. */
const STARTER_TINS=new Set(["tin-002","tin-003","tin-004"]);
const STARTER_ACTIVITY=new Set(["initial-1","initial-2"]);
export function dropStarter(w:Workspace):Workspace{
  return {...w,
    balance:w.balance===1280.5?0:w.balance,
    handle:w.handle==="quietcollector"?"":w.handle,
    tins:w.tins.filter(t=>!(STARTER_TINS.has(t.id)&&t.created.startsWith("2026-10-1"))),
    activity:w.activity.filter(a=>!STARTER_ACTIVITY.has(a.id)),
  };
}
let state=initial;
let loaded=false;
let limitTimer:ReturnType<typeof setTimeout>|undefined;
export const TIN_SIZES=TIN_DENOMINATIONS;
function scheduleLimits(){
  if(typeof window==="undefined")return;
  if(limitTimer)clearTimeout(limitTimer);
  if(!state.pendingLimits)return;
  limitTimer=setTimeout(()=>{const pending=state.pendingLimits;if(pending&&new Date(pending.at).getTime()<=Date.now())save({...state,dailyLimit:pending.daily,weeklyLimit:pending.weekly,pendingLimits:null});else if(pending)scheduleLimits();},Math.max(0,new Date(state.pendingLimits.at).getTime()-Date.now()));
}
const listeners=new Set<()=>void>();
function load(){
  if(loaded||typeof window==="undefined")return;
  loaded=true;
  try{const raw=JSON.parse(localStorage.getItem(KEY)??"null") as Workspace|null;if(raw?.version===1&&Number.isFinite(raw.balance)&&Array.isArray(raw.tins)&&Array.isArray(raw.gifts)&&Array.isArray(raw.activity))state={...initial,...raw};}catch{/* Invalid local state falls back to an empty workspace. */}
  const cleaned=dropStarter(state);
  let migrated=JSON.stringify(cleaned)!==JSON.stringify(state);
  state=cleaned;
  // Preserve stored records while removing the old exact-card acquisition implication.
  const tins=state.tins.map(t=>{
    if(t.status==="Kept"||t.productId==="tin-unassigned")return t;
    migrated=true;
    return {...t,referenceProductId:t.referenceProductId??t.productId,productId:"tin-unassigned",requiresFundingReview:!TIN_SIZES.some(size=>size===t.amount)};
  });
  if(migrated){state={...state,tins};try{localStorage.setItem(KEY,JSON.stringify(state));}catch{/* Preserve in memory. */}}
  if(state.pendingLimits&&new Date(state.pendingLimits.at).getTime()<=Date.now())state={...state,dailyLimit:state.pendingLimits.daily,weeklyLimit:state.pendingLimits.weekly,pendingLimits:null};
  scheduleLimits();
}
function snapshot(){load();return state;}
function subscribe(fn:()=>void){listeners.add(fn);return()=>listeners.delete(fn);}
/** Local preferences (handle, limits, cool-off, gifts, activity) plus, when a live wallet is unlocked, its real balance and tins. */
export function useWorkspace(){
  const local=useSyncExternalStore(subscribe,snapshot,()=>initial);
  const live=useLive();
  // The wallet mutates in place; live.version changes on every update, so derive each render.
  return live.wallet?withLive(local,live.wallet):local;
}
/** Live mode: the starter balance and example tins are replaced by the wallet's own. */
function withLive(local:Workspace,w:Wallet):Workspace{
  const tins:Tin[]=w.state.tins.filter(t=>t.state!=="Cancelled"&&!t.gift).map(t=>({id:`tin-live-${t.index}`,name:`Tin ${t.index+1}`,productId:"tin-unassigned",referenceProductId:"pack-01",amount:Number(t.usdg??t.size)/1e6,status:t.state==="Requested"?"Queued":"Ready",shared:false,created:t.createdAt}));
  return {...local,balance:Number(w.balance)/1e6,tins};
}
/** Record a live action in the local activity list (amounts are display-only numbers). */
export function logActivity(title:string,detail:string,amount=0,kind?:Activity["kind"]){save({...state,activity:[{...event(title,detail,amount),...(kind?{kind}:{})},...state.activity]});}
function save(next:Workspace){state=next;try{localStorage.setItem(KEY,JSON.stringify(state));}catch{/* In-memory interactions remain usable without storage. */}scheduleLimits();listeners.forEach(fn=>fn());}
const id=()=>crypto.randomUUID();
const event=(title:string,detail:string,amount=0):Activity=>({id:id(),title,detail,amount,at:new Date().toISOString()});
export function adjustBalance(amount:number,kind:"deposit"|"withdraw"){
  if(!Number.isFinite(amount)||amount<=0)throw new Error("Enter an amount greater than zero.");
  if(kind==="withdraw"&&amount>state.balance)throw new Error("That is more than the workspace balance.");
  const delta=kind==="deposit"?amount:-amount;
  save({...state,balance:Math.round((state.balance+delta)*100)/100,activity:[event(kind==="deposit"?"Deposit entry saved":"Withdrawal entry saved","Local workspace only; no funds moved",delta),...state.activity]});
}
export function allocateTin(name:string,amount:number){
  if(!name.trim())throw new Error("Give this tin a name.");
  if(!Number.isFinite(amount)||amount<=0||amount>state.balance)throw new Error("Choose an amount within your available balance.");
  if(!TIN_SIZES.some(size=>size===amount))throw new Error("Choose a supported tin size: 10, 25, 50, 100, 250, 500 or 1,000 USDG.");
  const tin:Tin={id:`tin-${id().slice(0,8)}`,name:name.trim(),productId:"tin-unassigned",amount,status:"Queued",shared:false,created:new Date().toISOString()};
  save({...state,balance:Math.round((state.balance-amount)*100)/100,tins:[tin,...state.tins],activity:[{...event("Tin allocation saved",`${name.trim()} · awaiting live funding`,-amount),kind:"tin-funding"},...state.activity]});
  return tin;
}
export function toggleShare(tinId:string){save({...state,tins:state.tins.map(t=>t.id===tinId?{...t,shared:!t.shared}:t),activity:[event("Room preference saved","Only the selected tin is included"),...state.activity]});}
export function createGift(name:string,amount:number,message:string){
  if(!name.trim()||!Number.isFinite(amount)||amount<=0||amount>state.balance)throw new Error("Add a name and an amount within your available balance.");
  const gift:Gift={id:id(),name:name.trim(),amount,message:message.trim(),created:new Date().toISOString(),status:"Draft"};
  save({...state,gifts:[gift,...state.gifts],activity:[event("Gift draft saved",`${name.trim()} · ${amount.toFixed(2)} USDG`),...state.activity]});return gift;
}
export function cancelGift(giftId:string){save({...state,gifts:state.gifts.map(g=>g.id===giftId?{...g,status:"Cancelled"}:g),activity:[event("Gift draft cancelled","No funds were reserved"),...state.activity]});}
export function updateHandle(handle:string){if(!/^[a-zA-Z0-9_]{3,20}$/.test(handle))throw new Error("Use 3–20 letters, numbers or underscores.");save({...state,handle,activity:[event("Season handle saved",handle),...state.activity]});}
/** Pack-spend checks are separate from advance tin funding. Call before exposing a tin to a rip. */
export function assertRipAllowed(amount:number,workspace:Workspace=state){
  if(!Number.isFinite(amount)||amount<=0)throw new Error("A live machine price is required.");
  if(workspace.coolOffUntil&&new Date(workspace.coolOffUntil).getTime()>Date.now())throw new Error("Your seven-day cool-off is active.");
  const region=regionAllowed(workspace.region,typeof navigator==="undefined"?null:navigator.language);
  if(!region.allowed)throw new Error(region.reason);
  const spent=(days:number)=>workspace.activity.filter(a=>a.kind==="pack-spend"&&Date.now()-new Date(a.at).getTime()<days*86400000).reduce((n,a)=>n+Math.abs(a.amount),0);
  if(amount+spent(1)>workspace.dailyLimit||amount+spent(7)>workspace.weeklyLimit)throw new Error("This pack exceeds your spending limits.");
}
export function updateLimits(daily:number,weekly:number){
  if(!Number.isFinite(daily)||!Number.isFinite(weekly)||daily<=0||weekly<daily)throw new Error("Weekly limit must be at least the daily limit.");
  const raising=daily>state.dailyLimit||weekly>state.weeklyLimit;
  save({...state,dailyLimit:Math.min(daily,state.dailyLimit),weeklyLimit:Math.min(weekly,state.weeklyLimit),pendingLimits:raising?{daily,weekly,at:new Date(Date.now()+86400000).toISOString()}:null,activity:[event(raising?"Limit increase scheduled":"Spending limits saved",raising?"Lower caps apply now; increases wait 24 hours":"Lower limits apply immediately"),...state.activity]});
}
export function updateRegion(region:string){if(!/^[A-Za-z]{2}$/.test(region))throw new Error("Use a two-letter country code, like US or GB.");save({...state,region:region.toUpperCase(),activity:[event("Region saved",region.toUpperCase()),...state.activity]});}
/** Preferences that the encrypted backup carries across devices (Build §9). */
export function currentPrefs():Pick<BackupData,"limits"|"region"|"spends">{
  return {limits:{dailyLimit:state.dailyLimit,weeklyLimit:state.weeklyLimit,pendingLimits:state.pendingLimits,coolOffUntil:state.coolOffUntil},region:state.region??null,
    spends:state.activity.filter(a=>a.kind==="pack-spend").map(a=>({at:a.at,amount:Math.abs(a.amount)}))};
}
/** Restore from backup: the stricter limits win and missing pack spends are added back. */
export function applyPrefs(p:Pick<BackupData,"limits"|"region"|"spends">){
  load();
  const m=mergeLimits(currentPrefs().limits,p.limits);
  const known=new Set(state.activity.filter(a=>a.kind==="pack-spend").map(a=>a.at));
  const spends=p.spends.filter(s=>!known.has(s.at)).map(s=>({id:id(),title:"Pack spend (restored)",detail:"From your encrypted backup",amount:-s.amount,at:s.at,kind:"pack-spend" as const}));
  save({...state,dailyLimit:m.dailyLimit,weeklyLimit:m.weeklyLimit,pendingLimits:m.pendingLimits,coolOffUntil:m.coolOffUntil,region:state.region??p.region,activity:[...spends,...state.activity]});
}
export function startCoolOff(){save({...state,coolOffUntil:new Date(Date.now()+7*86400000).toISOString(),activity:[event("Cool-off enabled","New pack rips paused for 7 days"),...state.activity]});}
export function downloadJson(name:string,data:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
export const money=(amount:number)=>amount.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
