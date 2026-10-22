"use client";
import {PixelIcon} from "@/components/ui/pixel-icon";
import {useEffect,useRef,useState} from "react";
import {animated,useSpring} from "@react-spring/web";
import type {Collectible} from "@/data/foil-catalog";
import {InspectionStage} from "./inspection-stage";
import {Action,Badge} from "./dashboard-ui";

export function CardInspector({products,index,onIndex,onClose,onPrepare,actionLabel="Prepare a tin"}:{products:Collectible[];index:number;onIndex:(n:number)=>void;onClose:()=>void;onPrepare:(product:Collectible)=>void;actionLabel?:string}){
  const ref=useRef<HTMLDialogElement>(null);
  const [expanded,setExpanded]=useState(false);
  const [copied,setCopied]=useState(false);
  const product=products[index];
  const style=useSpring({from:{opacity:0,y:16},to:{opacity:1,y:0},config:{tension:300,friction:30}});
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close();},[]);
  function change(delta:number){ref.current?.scrollTo({top:0});setCopied(false);onIndex((index+delta+products.length)%products.length);}
  async function copy(){try{await navigator.clipboard.writeText(product.certification??product.id);setCopied(true);}catch{setCopied(false);}}
  const verify=product.certification&&product.grader?(product.grader==="PSA"?`https://www.psacard.com/cert/${product.certification}`:product.grader==="CGC"?`https://www.cgccards.com/certlookup/${product.certification}/`:null):null;
  return <dialog ref={ref} aria-label={`${product.name} card inspection`} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}} onKeyDown={e=>{if((e.target as HTMLElement).tagName==="INPUT")return;if(e.key==="ArrowRight")change(1);if(e.key==="ArrowLeft")change(-1);}} className="foil-dashboard m-auto max-h-[var(--inspector-shell-height)] w-[var(--inspector-shell-width)] max-w-7xl overflow-y-auto rounded-2xl border border-foreground/20 bg-background bg-(image:--workspace-gradient) p-0 text-foreground shadow-2xl backdrop:bg-navigation/90 mobile:rounded-xl" data-lenis-prevent>
    <animated.div style={style} className="p-6 mobile:p-4">
      <div className="sticky top-0 z-10 mb-5 flex items-center justify-between gap-4 bg-background py-3"><div className="mobile:sr-only"><p className="type-caps text-xs tracking-widest text-accent">Collection / Inspection</p><p className="mt-1 text-xs text-foreground-subtle">{String(index+1).padStart(2,"0")} of {String(products.length).padStart(2,"0")} · Authentic source photography</p></div><div className="flex gap-2 mobile:w-full mobile:justify-between"><button type="button" aria-label="Previous card" onClick={()=>change(-1)} className="flex size-11 items-center justify-center rounded-lg border border-foreground/20 text-xl"><PixelIcon name="arrow" className="size-5 rotate-180"/></button><button type="button" aria-label="Next card" onClick={()=>change(1)} className="flex size-11 items-center justify-center rounded-lg border border-foreground/20 text-xl"><PixelIcon name="arrow"/></button><button type="button" aria-label="Close inspection" onClick={onClose} className="flex size-11 items-center justify-center rounded-lg border border-foreground/20 text-xl"><PixelIcon name="close"/></button></div></div>
      <div className={`grid gap-7 ${expanded?"grid-cols-1":"grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] handheld:grid-cols-1"}`}>
        <InspectionStage key={product.tinId??product.id} product={product} expanded={expanded} onExpand={()=>setExpanded(!expanded)}/>
        {!expanded&&<div className="flex min-w-0 flex-col"><div className="mb-5 flex flex-wrap gap-2"><Badge>{product.category}</Badge><Badge muted>{product.grade??(product.kind==="pack"?"Wrapper reference":product.kind==="tin"?"Tin funding plan":"Art unavailable")}</Badge></div><h2 className="type-display whitespace-normal text-4xl leading-display mobile:text-3xl">{product.name}</h2><p className="mt-3 text-sm leading-copy text-foreground-subtle">{product.detail}</p>
          <dl className="my-7 space-y-4 border-y border-foreground/15 py-5 text-sm">{[{label:"Format",value:product.kind==="slab"?"Graded card · full slab":product.kind==="pack"?"Retail wrapper · reference art":product.kind==="tin"?"Unassigned tin plan":"Artwork unavailable"},{label:"Grade",value:product.grade??"Not applicable"},{label:"Year",value:product.year?String(product.year):"Not specified"},{label:"Certification",value:product.certification??"Not applicable"}].map(d=><div key={d.label} className="flex items-start justify-between gap-4"><dt className="text-foreground-subtle">{d.label}</dt><dd className="text-right">{d.value}</dd></div>)}</dl>
          {product.certification&&<div className="mb-6 flex flex-wrap gap-4"><button type="button" onClick={copy} className="min-h-11 text-xs text-accent">{copied?"Certification copied":"Copy certification"}<PixelIcon name={copied?"check":"copy"} className="ml-2 size-4"/></button>{verify&&<a href={verify} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-xs text-lavender">Verify with {product.grader}<PixelIcon name="external" className="ml-2 size-4"/></a>}</div>}
          <div className="mt-auto rounded-xl border border-lavender/20 bg-lavender/5 p-5"><p className="type-caps text-sm text-lavender">One collectible. One fresh tin.</p><p className="mt-3 mb-5 text-xs leading-copy text-foreground-subtle">Foil funds a fresh tin before a pack rip. A machine determines the pull; the pictured card is an artwork reference, not a selectable outcome. You choose whether to share the resulting tin.</p><Action className="w-full" onClick={()=>onPrepare(product)}>{actionLabel}<PixelIcon name="arrow" className="size-4"/></Action></div><p className="mt-4 text-xs leading-copy text-foreground-subtle">Images illustrate the collection experience. They do not represent live inventory or a purchase offer. Tin funding plans are saved locally. Retail wrapper photos are illustrative, not live machine listings.</p>
        </div>}
      </div>
    </animated.div>
  </dialog>;
}
