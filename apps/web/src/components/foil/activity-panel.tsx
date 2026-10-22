"use client";
import {useState} from "react";
import {downloadJson,money,type Workspace} from "@/lib/foil-workspace";
import {Action,Badge,Empty,field,Panel} from "./dashboard-ui";

export function ActivityPanel({workspace}:{workspace:Workspace}){
  const [query,setQuery]=useState("");
  const rows=workspace.activity.filter(a=>`${a.title} ${a.detail}`.toLowerCase().includes(query.toLowerCase()));
  return <Panel title="Your activity, on your device" eyebrow="Local record" action={<Action secondary onClick={()=>downloadJson("foil-activity.json",workspace.activity)}>Export ↓</Action>}><label className="mb-5 block"><span className="sr-only">Search activity</span><input type="search" className={field} placeholder="Search your activity…" value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="divide-y divide-foreground/15">{rows.map(a=><article key={a.id} className="flex items-center justify-between gap-5 py-5 mobile:flex-col mobile:items-start"><div><p className="type-caps whitespace-normal break-words text-xl">{a.title}</p><p className="mt-2 text-xs leading-copy text-foreground-subtle">{a.detail}</p><time dateTime={a.at} className="mt-2 block text-xs text-foreground-subtle">{new Date(a.at).toLocaleString()}</time></div><Badge muted>{a.amount?`${a.amount>0?"+":""}${money(a.amount)} USDG`:"Saved locally"}</Badge></article>)}</div>{!rows.length&&<Empty title="No matching records" copy="Try a different search term."/>}</Panel>;
}
