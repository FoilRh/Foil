"use client";
import {PixelIcon} from "@/components/ui/pixel-icon";
import {SelectField} from "./select-field";
import {useEffect,useState,useSyncExternalStore} from "react";
import {categories,collectibles,getTinCollectible,type Collectible} from "@/data/foil-catalog";
import {warmImage,warmCollectible} from "@/lib/foil-image-cache";
import type {Workspace} from "@/lib/foil-workspace";
import {Action,Empty,field} from "./dashboard-ui";
import {CollectibleCard} from "./collectible-card";
import {CardInspector} from "./card-inspector";
import type {WorkspaceDialog} from "./workspace-dialogs";

let savedSnapshot="[]";
const subscribeSaved=(fn:()=>void)=>{window.addEventListener("foil:saved",fn);window.addEventListener("storage",fn);return()=>{window.removeEventListener("foil:saved",fn);window.removeEventListener("storage",fn);};};
function readSaved(){try{return localStorage.getItem("foil-saved-collectibles")??savedSnapshot;}catch{return savedSnapshot;}}
function parseSaved(raw:string):string[]{try{const value:unknown=JSON.parse(raw);return Array.isArray(value)?value.filter((id):id is string=>typeof id==="string"):[];}catch{return [];}}
function writeSaved(next:string[]){savedSnapshot=JSON.stringify(next);try{localStorage.setItem("foil-saved-collectibles",savedSnapshot);}catch{/* Memory fallback. */}window.dispatchEvent(new Event("foil:saved"));}
export function CollectionPanel({workspace,open,catalog=false,discovery=false}:{workspace:Workspace;open:(d:WorkspaceDialog)=>void;catalog?:boolean;discovery?:boolean}){
  useEffect(()=>{if(!catalog)return;collectibles.forEach(p=>{if(p.backThumbnail)warmImage(p.backThumbnail);});if(collectibles[0])warmCollectible(collectibles[0]);},[catalog]);
  const [query,setQuery]=useState("");
  const [category,setCategory]=useState("all");
  const [grade,setGrade]=useState("all");
  const [sort,setSort]=useState("featured");
  const [compact,setCompact]=useState(false);
  const [onlySaved,setOnlySaved]=useState(false);
  const [filters,setFilters]=useState(false);
  const [limit,setLimit]=useState(12);
  const [inspection,setInspection]=useState<number|null>(null);
  const raw=useSyncExternalStore(subscribeSaved,readSaved,()=>"[]");
  const saved=parseSaved(raw);
  const all:Collectible[]=catalog?collectibles:workspace.tins.map(t=>({...getTinCollectible(t),name:t.name,tinId:t.id}));
  const products=all.filter(p=>(category==="all"||p.category===category)&&(grade==="all"||p.grader===grade)&&(!onlySaved||saved.includes(p.id))&&`${p.name} ${p.detail} ${p.category} ${p.grade??""}`.toLowerCase().includes(query.toLowerCase())).toSorted((a,b)=>sort==="name"?a.name.localeCompare(b.name):sort==="year"?(b.year??0)-(a.year??0):0);
  function toggleSaved(id:string){const next=saved.includes(id)?saved.filter(v=>v!==id):[...saved,id];writeSaved(next);}
  function clear(){setQuery("");setCategory("all");setGrade("all");setOnlySaved(false);setLimit(12);}
  function action(product:Collectible){setInspection(null);const tin=!catalog?workspace.tins.find(t=>t.id===product.tinId):undefined;open(tin?{kind:"tin",tin}:{kind:"allocate"});}
  return <div className="space-y-5">
    {!discovery&&<p className="max-w-2xl text-sm leading-copy text-foreground-subtle">{catalog?"Explore tokenized trading-card categories: Pokémon TCG, One Piece, sports and more. These reference scans show collectible types. A pack machine determines every pull.":"Every pull has its own tin. Inspect your cards, manage a tin or choose what to share."}</p>}
    {catalog&&<div role="group" aria-label="Collectible categories" className="flex gap-2 overflow-x-auto pb-1" data-lenis-prevent>{["all",...categories].map(c=><button type="button" key={c} aria-pressed={category===c} onClick={()=>{setCategory(c);setLimit(12);}} className={`min-h-11 shrink-0 rounded-lg border px-4 text-xs transition-colors duration-[var(--duration-hover)] ease-entrance ${category===c?"border-lavender bg-lavender text-display-ink":"border-foreground/15 bg-surface text-foreground-subtle hover:border-lavender/60"}`}>{c==="all"?"All collectibles":c}</button>)}</div>}
    <div className="flex items-center gap-2 mobile:flex-wrap">
      <div className="hidden shrink-0 gap-1 rounded-lg border border-foreground/15 p-1 tablet:flex desktop:flex laptop:flex"><button type="button" aria-label="Comfortable card grid" aria-pressed={!compact} onClick={()=>setCompact(false)} className={`flex size-10 items-center justify-center rounded-md ${!compact?"bg-lavender/15 text-lavender":"text-foreground-subtle"}`}><PixelIcon name="grid"/></button><button type="button" aria-label="Compact card grid" aria-pressed={compact} onClick={()=>setCompact(true)} className={`flex size-10 items-center justify-center rounded-md ${compact?"bg-lavender/15 text-lavender":"text-foreground-subtle"}`}><PixelIcon name="compact"/></button></div>
      <label className="min-w-0 flex-1 mobile:basis-full"><span className="sr-only">Search collectibles</span><input type="search" value={query} onChange={e=>{setQuery(e.target.value);setLimit(12);}} placeholder="Search cards, sets or players…" className={`${field} rounded-lg`}/></label>
      <label className="mobile:min-w-0 mobile:flex-1"><span className="sr-only">Sort collectibles</span><SelectField value={sort} onChange={e=>setSort(e.target.value)} className={`${field} rounded-lg`}><option value="featured">Featured first</option><option value="name">Name A–Z</option><option value="year">Newest release</option></SelectField></label>
      <button type="button" aria-label="Show collection filters" aria-expanded={filters} onClick={()=>setFilters(!filters)} className={`flex size-12 shrink-0 items-center justify-center rounded-lg border ${filters?"border-lavender text-lavender":"border-foreground/20 text-foreground-subtle"}`}><PixelIcon name="filter"/></button>
    </div>
    {filters&&<div className="flex flex-wrap items-end gap-4 rounded-xl border border-lavender/20 bg-surface p-4"><label className="space-y-2"><span className="block text-xs text-foreground-subtle">Grading service</span><SelectField value={grade} onChange={e=>setGrade(e.target.value)} className={`${field} rounded-lg`}><option value="all">All graders</option><option value="PSA">PSA</option><option value="CGC">CGC</option></SelectField></label><button type="button" aria-pressed={onlySaved} onClick={()=>setOnlySaved(!onlySaved)} className={`min-h-12 rounded-lg border px-4 text-sm ${onlySaved?"border-accent text-accent":"border-foreground/20"}`}><PixelIcon name="star" className="mr-2 size-4"/>Saved only</button><button type="button" onClick={clear} className="min-h-12 px-3 text-xs text-lavender">Reset filters</button></div>}
    <div className="flex items-center justify-between gap-3 text-xs text-foreground-subtle"><p className="whitespace-nowrap">{products.length} {products.length===1?"collectible":"collectibles"}{onlySaved?" · Saved":""}</p><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-accent"/> Original artwork</span></div>
    {products.length?<div className={`grid gap-4 mobile:grid-cols-2 mobile:gap-3 tablet:grid-cols-3 ${compact?"grid-cols-5 laptop:grid-cols-4":"grid-cols-4 laptop:grid-cols-3"}`}>{products.slice(0,limit).map((p,i)=><CollectibleCard key={p.tinId??p.id} product={p} actionLabel={catalog?"Inspect details":"Manage tin"} compact={compact} saved={saved.includes(p.id)} onSave={()=>toggleSaved(p.id)} onInspect={()=>setInspection(i)} onPrepare={()=>catalog?setInspection(i):action(p)}/>)}</div>:<Empty title="No cards match just yet" copy="Try another name, category or grading service."><Action onClick={clear}>Clear filters</Action></Empty>}
    {products.length>limit&&<div className="flex justify-center pt-3"><Action secondary onClick={()=>setLimit(limit+12)}>Show more collectibles <PixelIcon name="chevron" className="size-4"/></Action></div>}
    <p className="text-xs leading-copy text-foreground-subtle">{catalog?"Collection imagery illustrates the Foil experience. No live inventory, prices or marketplace settlement are connected.":"Your local collection records stay in this browser. Tin activity is public onchain; the live protocol is designed to keep ownership associations private."}</p>
    {inspection!==null&&products[inspection]&&<CardInspector products={products} index={inspection} onIndex={setInspection} onClose={()=>setInspection(null)} actionLabel={catalog?"Prepare a fresh tin":"Manage tin"} onPrepare={action}/>}
  </div>;
}
