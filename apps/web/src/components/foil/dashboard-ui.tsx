"use client";
import {Children,type ButtonHTMLAttributes,type ReactNode} from "react";

import {PixelLabel} from "@/components/ui/pixel-label";
export const field="w-full rounded-lg border border-foreground/25 bg-background px-4 py-3.5 text-sm text-foreground outline-none placeholder:text-foreground-subtle focus:border-accent";
export function Action({children,secondary=false,className="",...props}:ButtonHTMLAttributes<HTMLButtonElement>&{secondary?:boolean}){
  return <button type="button" {...props} className={`type-caps inline-flex min-h-11 rounded-lg items-center justify-center gap-3 border px-5 py-3 text-base tracking-wide transition-colors duration-[var(--duration-hover)] ease-entrance disabled:cursor-not-allowed disabled:opacity-40 ${secondary?"border-foreground/25 bg-transparent text-foreground hover:border-accent hover:text-accent":"border-accent bg-accent bg-(image:--gold-gradient) text-on-inverse hover:bg-foreground hover:border-foreground"} ${className}`}>{Children.map(children,child=>typeof child==="string"?<PixelLabel value={child}/>:child)}</button>;
}
export function Panel({title,eyebrow,children,action,className=""}:{title?:string;eyebrow?:string;children:ReactNode;action?:ReactNode;className?:string}){
  return <section className={`rounded-xl border border-foreground/15 bg-surface bg-(image:--panel-gradient) p-6 mobile:p-5 ${className}`}>{(title||eyebrow)&&<div className="mb-5 flex items-start justify-between gap-4"><div className="min-w-0">{eyebrow&&<p className="type-caps mb-1 text-xs tracking-widest text-accent">{eyebrow}</p>}{title&&<h2 className="type-display whitespace-normal text-2xl leading-display">{title}</h2>}</div>{action}</div>}{children}</section>;
}
export function Badge({children,muted=false}:{children:ReactNode;muted?:boolean}){return <span className={`type-caps inline-flex max-w-full flex-wrap items-center gap-2 whitespace-normal border px-2.5 py-1 text-xs leading-copy tracking-wide ${muted?"border-foreground/20 text-foreground-subtle":"border-accent/35 text-accent"}`}>{children}</span>;}
export function Empty({title,copy,children}:{title:string;copy:string;children?:ReactNode}){return <div className="border border-dashed border-foreground/25 p-10 text-center"><h3 className="type-display whitespace-normal text-2xl">{title}</h3><p className="mx-auto mt-3 mb-5 max-w-md text-sm leading-copy text-foreground-subtle">{copy}</p>{children}</div>;}
