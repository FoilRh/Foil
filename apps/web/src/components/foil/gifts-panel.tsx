"use client";
import {useSyncExternalStore} from "react";
import {cancelGift,downloadJson,money,type Workspace} from "@/lib/foil-workspace";
import {Action,Badge,Empty,Panel} from "./dashboard-ui";
import type {WorkspaceDialog} from "./workspace-dialogs";
import {useLive} from "@/lib/foil-live";
import {LiveGifts} from "./live-gifts";

const listenToDraft=(notify:()=>void)=>{window.addEventListener("popstate",notify);window.addEventListener("foil:navigate",notify);return()=>{window.removeEventListener("popstate",notify);window.removeEventListener("foil:navigate",notify);};};
const draftQuery=()=>new URLSearchParams(location.search).get("gift")??"";
function parseDraft(value:string):{id:string;name:string;amount:number;message:string}|null{
  try{const raw:unknown=JSON.parse(value);if(!raw||typeof raw!=="object")return null;const d=raw as Record<string,unknown>;if(typeof d.id!=="string"||typeof d.name!=="string"||typeof d.amount!=="number"||!Number.isFinite(d.amount)||d.amount<=0||typeof d.message!=="string")return null;return{id:d.id.slice(0,64),name:d.name.slice(0,48),amount:d.amount,message:d.message.slice(0,240)};}catch{return null;}
}
export function GiftsPanel({workspace,open,notify}:{workspace:Workspace;open:(d:WorkspaceDialog)=>void;notify:(text:string)=>void}){
  const incomingValue=useSyncExternalStore(listenToDraft,draftQuery,()=>"");
  const incoming=parseDraft(incomingValue);
  const live=useLive();
  async function copyGift(gift:Workspace["gifts"][number]){
    const link=`${location.origin}/dashboard?tab=gifts&gift=${encodeURIComponent(JSON.stringify({id:gift.id,name:gift.name,amount:gift.amount,message:gift.message}))}`;
    try{await navigator.clipboard.writeText(link);notify("Gift draft link copied. Live redemption is not connected.");}catch{downloadJson(`foil-gift-${gift.id}.json`,{...gift,link});notify("The gift draft was downloaded instead.");}
  }
  return <div className="space-y-6">{incomingValue&&<Panel title={incoming?"Someone shared a gift idea":"This gift draft could not be read"} eyebrow="Draft preview">{incoming?<div className="space-y-4"><h3 className="type-caps whitespace-normal text-2xl">{incoming.name}</h3><p className="text-accent">{money(incoming.amount)} USDG</p>{incoming.message&&<p className="text-sm leading-copy">“{incoming.message}”</p>}<p className="text-xs leading-copy text-foreground-subtle">This is an unfunded draft, not a claimable gift. No funds or wallet access are included.</p><Action secondary onClick={()=>downloadJson(`foil-gift-${incoming.id}.json`,incoming)}>Save gift details ↓</Action></div>:<p className="text-sm text-foreground-subtle">Ask the sender to copy a new draft link.</p>}</Panel>}<section className="relative overflow-hidden border border-accent/25 bg-surface bg-(image:--panel-gradient) p-8 mobile:p-5"><p className="type-script text-xl text-accent">A better kind of hand-off</p><h2 className="type-display whitespace-normal mt-3 text-5xl leading-display mobile:text-4xl">A little mystery.<br/>A lot of thought.</h2><p className="mt-5 mb-6 max-w-lg text-sm leading-copy text-foreground-subtle">Prepare a pack or card gift for someone. Save the amount, give it a name, and leave a note. Live gifts will use fresh recipient tins.</p><Action onClick={()=>open({kind:"gift"})}>Create a gift +</Action><span aria-hidden className="type-display pointer-events-none absolute right-8 bottom-0 text-9xl text-accent/5">GIFT</span></section>
    {live.wallet?<LiveGifts notify={notify}/>:workspace.gifts.length?<Panel title="Your gift drafts" eyebrow="Saved on your device"><div className="divide-y divide-foreground/15">{workspace.gifts.map(gift=><article key={gift.id} className="flex items-start justify-between gap-5 py-5 mobile:flex-col"><div><Badge muted={gift.status==="Cancelled"}>{gift.status}</Badge><h3 className="type-caps whitespace-normal mt-3 text-xl">{gift.name}</h3><p className="mt-2 text-sm text-accent">{money(gift.amount)} USDG</p>{gift.message&&<p className="mt-3 text-sm text-foreground-subtle">“{gift.message}”</p>}</div><div className="flex flex-wrap gap-2"><Action secondary onClick={()=>copyGift(gift)}>Copy draft link</Action><Action secondary onClick={()=>downloadJson(`foil-gift-${gift.id}.json`,gift)}>Export</Action>{gift.status==="Draft"&&<Action secondary onClick={()=>{cancelGift(gift.id);notify("Gift draft cancelled. No funds were reserved.");}}>Cancel draft</Action>}</div></article>)}</div></Panel>:<Empty title="Your first gift starts here" copy="Draft a gift without posting it publicly. Funds remain in your Stash until a live gift is created."><Action onClick={()=>open({kind:"gift"})}>Prepare a gift</Action></Empty>}
    {!live.wallet&&<p className="text-xs leading-copy text-foreground-subtle">Draft links contain the draft name, note and amount. These frontend drafts are not funded, private claim links. The shielded gift service and redemption require live integration.</p>}
  </div>;
}
