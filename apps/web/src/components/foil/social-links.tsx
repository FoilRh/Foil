"use client";

import { useState } from "react";
import {PixelIcon} from "@/components/ui/pixel-icon";
import { Modal } from "./modal";

const socials=[{name:"Telegram",icon:"telegram"},{name:"GitHub",icon:"github"},{name:"X",icon:"x"}] as const;
export function SocialLinks({channels,labels=false}:{channels?:readonly string[];labels?:boolean}={}){
  const [open,setOpen]=useState<string|null>(null);
  return <>
    <div className="flex flex-wrap items-center gap-2" aria-label="Foil social channels">
      {socials.filter(s=>!channels||channels.includes(s.name)).map(s=><button key={s.name} type="button" aria-label={s.name} title={s.name} onClick={()=>setOpen(s.name)} className={`pixel-control flex min-h-11 items-center justify-center gap-3 ${labels?"rounded-lg border border-foreground/25 px-5":"size-11"} text-foreground/75 transition-colors duration-[var(--duration-hover)] ease-entrance hover:text-accent focus-visible:outline-2 focus-visible:outline-accent`}><PixelIcon name={s.icon}/>{labels&&<span className="type-caps text-lg">Follow on {s.name}</span>}</button>)}
    </div>
    {open&&<Modal title={`${open} is coming soon`} onClose={()=>setOpen(null)}><p className="text-sm leading-copy text-foreground-muted">Foil’s official {open} channel is on its way. We’ll add the verified link here when it’s ready.</p><button type="button" onClick={()=>setOpen(null)} className="type-caps mt-6 border border-accent bg-accent px-6 py-3 text-on-inverse">Got it</button></Modal>}
  </>;
}
