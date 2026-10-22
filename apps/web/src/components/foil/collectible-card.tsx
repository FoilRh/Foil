"use client";
import Image from "next/image";
import {PixelIcon} from "@/components/ui/pixel-icon";
import {warmCollectible} from "@/lib/foil-image-cache";
import type {Collectible} from "@/data/foil-catalog";

export function CollectibleCard({product,onInspect,onPrepare,saved,onSave,compact=false,actionLabel="Prepare tin"}:{product:Collectible;onInspect:()=>void;onPrepare:()=>void;saved:boolean;onSave:()=>void;compact?:boolean;actionLabel?:string}){
  return <article data-kind={product.kind} className="foil-collectible group min-w-0"><div className="foil-collectible-body overflow-hidden bg-surface bg-(image:--panel-gradient)">
    <div className="foil-collectible-label flex min-h-14 items-center justify-between gap-1 bg-display-surface bg-(image:--display-gradient) px-3 mobile:px-2">
      <span className="shrink-0 whitespace-nowrap rounded-md bg-display-ink/85 px-2 py-1 text-xs text-display-surface">{product.grade?.replace(/ GEM MINT| MINT/g,"")??(product.kind==="tin"?"TIN PLAN":product.kind==="unavailable"?"UNAVAILABLE":"WRAPPER")}</span>
      <button type="button" aria-label={`${saved?"Unsave":"Save"} ${product.name}`} aria-pressed={saved} onClick={onSave} className={`flex size-11 shrink-0 items-center justify-center rounded-md border border-display-ink/10 bg-display-surface text-lg ${saved?"text-accent-strong":"text-display-ink/70"}`}><PixelIcon name="star" className={`size-5 ${saved?"opacity-100":"opacity-55"}`}/></button>
    </div>
    <button type="button" onPointerEnter={()=>warmCollectible(product)} onFocus={()=>warmCollectible(product)} onClick={onInspect} aria-label={`Inspect ${product.name}`} className={`foil-collectible-stage relative flex w-full items-center justify-center overflow-hidden bg-display-surface bg-(image:--display-gradient) px-5 pb-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${compact?"h-60":"h-72"} mobile:h-56 mobile:px-3 mobile:pb-4`}>
      <Image src={product.thumbnail??product.image} alt={`${product.name} · ${product.grade??(product.kind==="tin"?"unassigned tin plan":product.kind==="unavailable"?"artwork unavailable":"retail booster artwork")}`} width={450} height={675} loading="eager" sizes="(max-width:699px) 45vw, (max-width:1199px) 25vw, 20vw" className="h-full max-h-full w-auto max-w-full object-contain drop-shadow-md"/>
      <span className="absolute right-3 bottom-3 rounded-full bg-display-ink/90 px-3 py-2 text-xs text-display-surface opacity-0 transition-opacity duration-[var(--duration-hover)] ease-entrance group-hover:opacity-100 group-focus-within:opacity-100 handheld:hidden">Inspect <PixelIcon name="expand" className="ml-1 size-3"/></span>
    </button>
    <div className="p-4 mobile:p-3"><p className="mb-2 truncate text-xs text-lavender">{product.category}{product.year?` · ${product.year}`:""}</p><button type="button" onClick={onInspect} className="block w-full text-left"><h3 className="type-caps line-clamp-2 min-h-12 whitespace-normal text-xl leading-display mobile:text-lg">{product.name}</h3></button><p className="mt-2 line-clamp-2 min-h-9 text-xs leading-copy text-foreground-subtle">{product.detail}</p><button type="button" onClick={onPrepare} className="type-caps mt-4 flex min-h-11 w-full items-center justify-between border-t border-foreground/10 pt-3 text-sm text-accent">{actionLabel} <PixelIcon name="external" className="size-4"/></button></div>
  </div></article>;
}
