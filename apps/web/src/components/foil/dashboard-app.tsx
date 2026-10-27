"use client";
import {Spring} from "@/components/animation/springs/spring";
import {PixelIcon} from "@/components/ui/pixel-icon";
import {PixelLabel} from "@/components/ui/pixel-label";
import {PackRipsPanel} from "./pack-rips-panel";
import Link from "next/link";
import {useEffect,useState,useSyncExternalStore} from "react";
import {money,useWorkspace} from "@/lib/foil-workspace";
import {liveConfigured,lock,useLive} from "@/lib/foil-live";
import {ActivityPanel} from "./activity-panel";
import {CollectionPanel} from "./collection-panel";
import {GiftsPanel} from "./gifts-panel";
import {DiscoverPanel} from "./discover-panel";
import {SettingsPanel} from "./settings-panel";
import {StashPanel} from "./stash-panel";
import {SocialLinks} from "./social-links";
import {Action} from "./dashboard-ui";
import {WorkspaceDialogs,type WorkspaceDialog} from "./workspace-dialogs";
import {LiveRoom} from "./live-room";

const tabs=[
  {id:"overview",label:"Discover",icon:"spark",title:"Your private collecting space"},
  {id:"rips",label:"Pack rips",icon:"browser",title:"A fresh tin for every rip"},
  {id:"browser",label:"Card explorer",icon:"cards",title:"A world of trading cards"},
  {id:"tins",label:"My tins",icon:"tin",title:"Collected, your way"},
  {id:"stash",label:"My Stash",icon:"wallet",title:"Your Stash"},
  {id:"gifts",label:"Gifts",icon:"gift",title:"A thoughtful little mystery"},
  {id:"rooms",label:"Rip Room",icon:"room",title:"Your room, your rules"},
  {id:"activity",label:"Activity",icon:"activity",title:"Your activity"},
  {id:"settings",label:"Settings",icon:"settings",title:"Collect at your own pace"},
] as const;
const subscribe=(fn:()=>void)=>{window.addEventListener("popstate",fn);window.addEventListener("foil:navigate",fn);return()=>{window.removeEventListener("popstate",fn);window.removeEventListener("foil:navigate",fn);};};
function currentTab(){const value=new URLSearchParams(window.location.search).get("tab");return tabs.some(t=>t.id===value)?value??"overview":"overview";}
export function DashboardApp(){
  const tab=useSyncExternalStore(subscribe,currentTab,()=>"overview");const workspace=useWorkspace();
  const [dialog,setDialogRaw]=useState<WorkspaceDialog|null>(null);const [toast,setToast]=useState("");const [wallet,setWallet]=useState("");
  const live=useLive();
  // On a live deployment, money actions need the wallet: without it they open setup instead.
  const setDialog=(d:WorkspaceDialog|null)=>setDialogRaw(d&&liveConfigured&&live.phase!=="unlocked"&&(d.kind==="deposit"||d.kind==="withdraw"||d.kind==="allocate"||d.kind==="gift")?{kind:"setup"}:d);
  const selected=tabs.find(t=>t.id===tab)??tabs[0];
  useEffect(()=>{if(!toast)return;const timer=window.setTimeout(()=>setToast(""),6000);return()=>window.clearTimeout(timer);},[toast]);
  function navigate(next:string){const url=new URL(location.href);url.searchParams.set("tab",next);url.searchParams.delete("gift");history.pushState(null,"",url);window.dispatchEvent(new Event("foil:navigate"));window.scrollTo({top:0});}
  function connect(){
    if(liveConfigured){if(live.phase==="unlocked"){lock();setToast("Foil wallet locked.");}else if(live.phase!=="loading")setDialog({kind:"setup"});return;}
    if(wallet){setWallet("");setToast("Wallet disconnected from this browser view.");}else setDialog({kind:"wallet"});
  }
  const walletLabel=liveConfigured?(live.phase==="unlocked"?(live.syncing?"Syncing… ×":"Foil unlocked ×"):live.phase==="locked"?"Unlock Foil ↗":live.phase==="new"?"Set up Foil ↗":"Loading…"):wallet?`${wallet.slice(0,6)}…${wallet.slice(-4)} ×`:"Connect wallet ↗";
  return <div className="foil-dashboard min-h-svh bg-background bg-(image:--workspace-gradient) text-foreground">
    <header className="sticky top-0 z-20 flex h-20 items-center justify-between gap-4 border-b border-foreground/10 bg-navigation bg-(image:--navigation-gradient) px-6 mobile:h-18 mobile:px-4"><Link href="/" aria-label="Foil home" className="type-display text-4xl text-accent">FOIL</Link><div className="flex items-center gap-3 mobile:gap-2"><button type="button" onClick={()=>navigate("stash")} className="hidden min-h-11 items-center gap-3 rounded-lg border border-accent/20 bg-accent/5 px-4 text-xs text-accent tablet:flex desktop:flex laptop:flex">Stash <span>{money(workspace.balance)} USDG</span></button><button type="button" onClick={connect} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-lavender/30 px-4 text-xs text-foreground hover:bg-lavender/10"><PixelLabel value={walletLabel}/></button></div></header>
    <div className="flex min-h-[var(--dashboard-body-height)]">
      <aside aria-label="Dashboard navigation" className="sticky top-20 flex h-[var(--dashboard-body-height)] w-52 shrink-0 flex-col border-r border-foreground/10 bg-navigation bg-(image:--navigation-gradient) p-4 handheld:hidden"><p className="mb-5 px-3 pt-3 text-xs text-foreground-subtle">Your private corner</p><nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto" data-lenis-prevent>{tabs.map(t=><button type="button" key={t.id} aria-current={tab===t.id?"page":undefined} onClick={()=>navigate(t.id)} className={`flex min-h-12 items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors duration-[var(--duration-hover)] ease-entrance ${tab===t.id?"bg-(image:--dawn-gradient) text-display-ink":"text-foreground-subtle hover:bg-foreground/5 hover:text-foreground"}`}><PixelIcon name={t.icon} className="size-5"/>{t.label}</button>)}</nav><div className="mt-auto pt-6"><div className="rounded-xl border border-peach/20 bg-peach/5 p-4 short-screen:hidden"><p className="type-script text-lg text-peach">A little less public.</p><p className="mt-3 text-xs leading-copy text-foreground-subtle">One fresh tin per pull.<br/>Your keys. Your choice.</p></div><div className="mt-4"><SocialLinks channels={["X","Telegram"]}/></div><Link href="/" className="mt-2 inline-flex min-h-11 items-center px-2 text-xs text-foreground-subtle"><PixelIcon name="arrow" className="mr-2 size-4 rotate-180"/>Back to Foil</Link></div></aside>
      <div className="min-w-0 flex-1"><nav aria-label="Dashboard sections" className="sticky top-18 z-10 hidden gap-1 overflow-x-auto border-b border-foreground/10 bg-background px-4 py-2 handheld:flex tablet:top-20" data-lenis-prevent>{tabs.map(t=><button type="button" key={t.id} aria-current={tab===t.id?"page":undefined} onClick={()=>navigate(t.id)} className={`min-h-11 inline-flex items-center gap-2 shrink-0 rounded-lg px-4 text-xs ${tab===t.id?"bg-(image:--dawn-gradient) text-display-ink":"text-foreground-subtle"}`}><PixelIcon name={t.icon} className="size-4"/>{t.label}</button>)}</nav>
        <Spring key={tab} tag="main" from={{opacity:0.7,transform:"translateY(1%)"}} to={{opacity:1,transform:"translateY(0%)"}} config={{tension:240,friction:30,clamp:true}} className="mx-auto max-w-screen-2xl px-7 py-7 mobile:px-4 mobile:py-6 tablet:px-6">
          <p className="mb-5 inline-flex items-center gap-2 rounded-md border border-lavender/20 bg-lavender/5 px-3 py-2 text-xs text-lavender"><PixelIcon name="shield" className="size-4"/>Your keys. Your cards. Your choice.</p><div className="mb-6 flex items-end justify-between gap-5 mobile:flex-col mobile:items-start"><div className="min-w-0"><p className="mb-2 text-xs tracking-widest text-lavender uppercase">{tab==="overview"?(workspace.handle?`Welcome, @${workspace.handle}`:"Welcome"):`Your Foil / ${selected.label}`}</p><h1 className="type-display whitespace-normal bg-(image:--dawn-gradient) bg-clip-text text-4xl leading-display text-transparent mobile:text-3xl">{selected.title}</h1></div>{(tab==="tins"||tab==="stash")&&<Action onClick={()=>setDialog({kind:"allocate"})}>New tin +</Action>}</div>
          {tab==="overview"&&<DiscoverPanel workspace={workspace} open={setDialog} navigate={navigate}/>}
          {tab==="rips"&&<PackRipsPanel workspace={workspace} open={setDialog} navigate={navigate}/>}
          {tab==="stash"&&<StashPanel workspace={workspace} open={setDialog}/>}
          {(tab==="tins"||tab==="browser")&&<CollectionPanel key={tab} workspace={workspace} open={setDialog} catalog={tab==="browser"}/>}
          {tab==="gifts"&&<GiftsPanel workspace={workspace} open={setDialog} notify={setToast}/>}
          {tab==="rooms"&&live.wallet?<LiveRoom notify={setToast}/>:(tab==="settings"||tab==="rooms")&&<SettingsPanel key={tab} workspace={workspace} notify={setToast} rooms={tab==="rooms"}/>}
          {tab==="activity"&&<ActivityPanel workspace={workspace}/>}
          <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-foreground/10 pt-5 text-xs text-foreground-subtle"><p>© 2026 Foil · Your cards. Your business.</p><div className="flex items-center gap-5"><a href="/docs/foil-overview.pdf" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center">Protocol <PixelIcon name="external" className="ml-1 size-3"/></a><Link href="/privacy-policy" className="inline-flex min-h-11 items-center">Privacy</Link><span className="rounded-md border border-foreground/15 px-2 py-1">Your private corner</span></div><div className="hidden handheld:block"><SocialLinks channels={["X","Telegram"]}/></div></footer>
        </Spring>
      </div>
    </div>
    {toast&&<div role="status" aria-live="polite" className="fixed right-6 bottom-6 z-50 max-w-sm rounded-xl border border-accent/50 bg-surface p-5 text-sm leading-copy shadow-2xl mobile:right-4 mobile:bottom-4 mobile:left-4">{toast}<button type="button" aria-label="Dismiss notification" className="ml-3 inline-flex size-11 items-center justify-center text-accent" onClick={()=>setToast("")}><PixelIcon name="close" className="size-4"/></button></div>}
    {dialog&&<WorkspaceDialogs key={dialog.kind} dialog={dialog} onClose={()=>setDialog(null)} onSaved={setToast} onWallet={setWallet}/>}
  </div>;
}
