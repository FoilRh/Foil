"use client";
import Image from "next/image";
import {PixelIcon} from "@/components/ui/pixel-icon";
import {SelectField} from "./select-field";
import {useState,type FormEvent} from "react";
import { getCollectible,getTinCollectible } from "@/data/foil-catalog";
import { TIN_SIZES,adjustBalance,allocateTin,createGift,downloadJson,logActivity,money,toggleShare,type Tin } from "@/lib/foil-workspace";
import { findTin,liveCancelTin,liveCreateGift,liveDeposit,liveRequestTin,liveSendBack,liveTinKey,liveWithdraw,useLive } from "@/lib/foil-live";
import type { TinSize } from "@foil/protocol";
import { VaultSetup } from "./vault-setup";
import { Modal } from "./modal";
import { Action, Badge, field } from "./dashboard-ui";

export type WorkspaceDialog={kind:"deposit"|"withdraw"|"allocate"|"gift"|"wallet"|"setup"}|{kind:"tin";tin:Tin};
interface InjectedProvider{request:(options:{method:string})=>Promise<unknown>}
export function WorkspaceDialogs({dialog,onClose,onSaved,onWallet}:{dialog:WorkspaceDialog;onClose:()=>void;onSaved:(message:string)=>void;onWallet:(address:string)=>void}){
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const chosen=getCollectible("tin-unassigned");
  const [amount,setAmount]=useState("25");
  const [name,setName]=useState(dialog.kind==="allocate"?"Fresh pack tin":"");
  const [message,setMessage]=useState("");
  const [recipient,setRecipient]=useState("");
  const [tinKey,setTinKey]=useState("");
  const live=useLive();
  const isLive=live.phase==="unlocked";
  const liveTin=dialog.kind==="tin"?findTin(dialog.tin.id):undefined;
  const title=dialog.kind==="setup"?(live.phase==="locked"?"Unlock Foil":"Set up your Foil wallet"):dialog.kind==="tin"?dialog.tin.name:dialog.kind==="deposit"?"Add to your Stash":dialog.kind==="withdraw"?"Withdraw from Stash":dialog.kind==="allocate"?"Prepare a fresh tin":dialog.kind==="gift"?"Create a gift draft":"Your wallet, your keys";
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setError("");setBusy(true);
    try{
      if(isLive&&dialog.kind==="deposit"){await liveDeposit(Number(amount));logActivity("Deposit sent","Joins your Stash after screening (15 to 60 minutes)",Number(amount));onSaved("Deposit sent. It joins your Stash after screening.");}
      else if(isLive&&dialog.kind==="withdraw"){const to=recipient.trim();await liveWithdraw(Number(amount),to);logActivity("Withdrawal sent",`To ${to.slice(0,6)}…${to.slice(-4)}`,-Number(amount));onSaved("Withdrawal submitted.");}
      else if(isLive&&dialog.kind==="allocate"){const t=await liveRequestTin(Number(amount) as TinSize);logActivity("Tin requested",`Round ${t.roundId} · funded when the round executes`,-Number(amount),"tin-funding");onSaved("Tin requested. It is funded when its round executes, usually within 10 to 30 minutes.");}
      else if(isLive&&dialog.kind==="gift"){const t=await liveCreateGift(Number(amount) as TinSize,message);logActivity("Gift tin requested",`Round ${t.roundId} · link ready when funded`,-Number(amount),"tin-funding");onSaved("Gift requested. Its link appears in Gifts once the round executes.");}
      else if(dialog.kind==="deposit"||dialog.kind==="withdraw"){adjustBalance(Number(amount),dialog.kind);onSaved("Workspace balance updated. No onchain funds moved.");}
      else if(dialog.kind==="allocate"){allocateTin(name,Number(amount));onSaved("Tin funding plan saved locally. Live round submission is not connected.");}
      else if(dialog.kind==="gift"){createGift(name,Number(amount),message);onSaved("Gift draft saved. No funds have been reserved.");}
      onClose();
    }catch(e){setError(e instanceof Error?e.message:"Unable to save. Please try again.");}finally{setBusy(false);}
  }
  async function tinAction(kind:"return"|"cancel"){
    if(!liveTin)return;
    setError("");setBusy(true);
    try{
      if(kind==="return"){const amt=Number(liveTin.usdg??liveTin.size)/1e6;if(amt<1)throw new Error("This tin holds less than the 1 USDG minimum to send back.");await liveSendBack(liveTin,amt);logActivity("Tin sent back to Stash",`Tin ${liveTin.index+1} · joins after screening`,amt);onSaved("Sending back to your Stash. It joins after screening.");}
      else{await liveCancelTin(liveTin);logActivity("Tin request cancelled",`Tin ${liveTin.index+1} · reserved amount back in your Stash`,Number(liveTin.reserved)/1e6);onSaved("Request cancelled. The reserved amount is back in your Stash.");}
      onClose();
    }catch(e){setError(e instanceof Error?e.message:"That did not go through.");}finally{setBusy(false);}
  }
  async function connect(){
    setBusy(true);setError("");
    try{const provider=(window as Window&{ethereum?:InjectedProvider}).ethereum;if(!provider)throw new Error("No browser wallet was found. Open Foil in a wallet-enabled browser, or continue using the local workspace.");const accounts=await provider.request({method:"eth_requestAccounts"});if(!Array.isArray(accounts)||typeof accounts[0]!=="string")throw new Error("The wallet did not return an account.");onWallet(accounts[0]);onSaved("Wallet address connected. Live funding is not enabled.");onClose();}catch(e){setError(e instanceof Error?e.message:"Connection was cancelled.");}finally{setBusy(false);}
  }
  return <Modal title={title} onClose={onClose}>
    {dialog.kind==="setup"?<VaultSetup onDone={m=>{onSaved(m);onClose();}}/>:
    liveTin?<div className="space-y-5"><div className="flex flex-col gap-2 border border-foreground/15 p-4"><Badge>{liveTin.state==="Requested"?"Waiting for its round":liveTin.state==="Funded"?"Funded":liveTin.state}</Badge><p className="type-display text-3xl">{money(Number(liveTin.usdg??liveTin.size)/1e6)} <span className="text-base text-accent">USDG</span></p><p className="text-xs text-foreground-subtle">Round {liveTin.roundId}{liveTin.reqIdx>=0?` · request ${liveTin.reqIdx}`:" · recovered from your phrase"}{liveTin.cards?.length?` · ${liveTin.cards.length} card${liveTin.cards.length>1?"s":""}`:""}</p></div>
      {liveTin.state==="Requested"&&<><p className="text-xs leading-copy text-foreground-subtle">Rounds close on 10-minute boundaries with at least 8 requests, or 30 minutes after the first. If a closed round is not executed within 60 minutes, you can fund the tin yourself or cancel.</p><Action secondary className="w-full" disabled={busy} onClick={()=>tinAction("cancel")}>{busy?"Working…":"Cancel request"}</Action></>}
      {liveTin.state!=="Requested"&&<><p className="text-xs leading-copy text-foreground-subtle">Sending a tin back moves its USDG to your Stash, free up to what it was funded with. The tin needs no gas for this.</p><Action className="w-full" disabled={busy} onClick={()=>tinAction("return")}>{busy?"Working…":"Send back to Stash"}</Action></>}
      <div className="border-t border-foreground/15 pt-4"><p className="text-xs leading-copy text-foreground-subtle">Key export shows this tin&apos;s private key. Anyone who has it controls the tin and what it holds.</p>{tinKey?<p className="mt-3 break-all rounded-lg border border-highlight-secondary/40 p-3 font-mono text-xs">{tinKey}</p>:<Action secondary className="mt-3 w-full" onClick={()=>setTinKey(liveTinKey(liveTin))}>Show tin key</Action>}</div>
      {error&&<p role="alert" className="text-sm text-highlight-secondary">{error}</p>}</div>:
    dialog.kind==="wallet"?<div className="space-y-5"><p className="text-sm leading-copy text-foreground-muted">Connect a browser wallet to display its public address. Foil will not request a signature or permission to spend.</p><Badge>Robinhood Chain · 4663</Badge><Action onClick={connect} disabled={busy} className="w-full">{busy?"Waiting for wallet…":"Connect browser wallet"}</Action><Action secondary onClick={onClose} className="w-full">Continue with local workspace</Action></div>:
    dialog.kind==="tin"?<div className="space-y-5"><div className="flex gap-5 border border-foreground/15 p-4"><Image src={getTinCollectible(dialog.tin).image} alt={dialog.tin.name} width={100} height={145} className="h-40 w-25 object-contain"/><div className="flex flex-col justify-center gap-2"><Badge>{dialog.tin.status}</Badge><p className="type-caps text-sm text-foreground-subtle">{dialog.tin.id}</p><p className="type-display text-3xl">{money(dialog.tin.amount)} <span className="text-base text-accent">USDG</span></p></div></div><dl className="space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-foreground-subtle">Funding</dt><dd>10-minute cadence; up to 30 minutes</dd></div><div className="flex justify-between gap-4"><dt className="text-foreground-subtle">Wallet address</dt><dd>Created on device by live wallet</dd></div><div className="flex justify-between gap-4"><dt className="text-foreground-subtle">Room selection</dt><dd>{dialog.tin.shared?"Selected locally":"Not selected"}</dd></div></dl>{dialog.tin.referenceProductId&&<p className="text-xs leading-copy text-peach">Imported local funding plan. Its artwork reference is preserved; no specific pull is selected.{dialog.tin.requiresFundingReview&&" Review its amount against supported sizes before live submission."}</p>}<p className="text-xs leading-copy text-foreground-subtle">Posting a hit links this tin to your season handle. Multiple posts link those tins together; removing a post cannot undo what was already public. This control only saves a local selection.</p><Action secondary className="w-full" onClick={()=>{toggleShare(dialog.tin.id);onSaved("Sharing preference updated for this tin only.");onClose();}}>{dialog.tin.shared?"Unselect for my room":"Select for my room"}</Action><p className="text-xs leading-copy text-foreground-subtle">After a live pull: keep the card, check a provider sell-back quote, gift it or request Quiet Ship. Key export requires on-device wallet keys; this frontend exports records only.</p><Action className="w-full" onClick={()=>downloadJson(`${dialog.tin.id}.json`,{...dialog.tin,recordType:"local-foil-tin",onchainSettlement:false})}>Export tin record <PixelIcon name="chevron" className="size-4"/></Action></div>:
    <form onSubmit={submit} className="space-y-5">
      {dialog.kind==="allocate"&&<div className="flex items-center gap-4 border border-foreground/15 p-3"><Image src={chosen.image} alt={chosen.name} width={55} height={80} className="h-20 w-14 object-contain"/><div><p className="type-caps text-lg">A fresh wallet for a future rip</p><p className="text-xs text-foreground-subtle">Choose the machine separately in Pack rips. This budget does not select a specific card.</p></div></div>}
      {(dialog.kind==="allocate"||(dialog.kind==="gift"&&!isLive))&&<label className="block space-y-2"><span className="type-caps text-sm tracking-wide">{dialog.kind==="gift"?"Gift name":"Tin name"}</span><input autoFocus required maxLength={48} className={field} value={name} onChange={e=>setName(e.target.value)} placeholder={dialog.kind==="gift"?"A pack for someone special":"Name your tin"}/></label>}
      <label className="block space-y-2"><span className="type-caps text-sm tracking-wide">{dialog.kind==="allocate"?"Tin size":"Amount"} · USDG</span>{dialog.kind==="allocate"||(isLive&&dialog.kind==="gift")?<SelectField aria-label="Tin size in USDG" value={amount} onChange={e=>setAmount(e.target.value)}>{TIN_SIZES.map(size=><option key={size} value={size}>{size.toLocaleString("en-US")} USDG</option>)}</SelectField>:<input autoFocus type="number" min="0.01" step="0.01" required className={field} value={amount} onChange={e=>setAmount(e.target.value)}/>}</label>
      {isLive&&dialog.kind==="withdraw"&&<label className="block space-y-2"><span className="type-caps text-sm tracking-wide">Destination address</span><input required className={field} value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false}/></label>}
      {dialog.kind==="allocate"&&<p className="text-xs leading-copy text-foreground-subtle">Funding rounds target 10-minute boundaries and may wait up to 30 minutes when small. Fees and gas need a live quote; no funds or keys are created here. Funding a tin does not count as pack spending.</p>}
      {dialog.kind==="gift"&&<label className="block space-y-2"><span className="type-caps text-sm tracking-wide">A note, if you like</span><textarea className={field} rows={3} maxLength={240} value={message} onChange={e=>setMessage(e.target.value)}/></label>}
      <div className="border-l-2 border-accent/50 pl-4 text-xs leading-copy text-foreground-subtle">{isLive&&dialog.kind==="gift"?"Funds a fresh tin from your Stash in the next round (tin size plus 0.15% + $0.20, gas at cost and a $0.25 relayer fee). Anyone with the link can claim it until it is claimed, so share it privately.":isLive?(dialog.kind==="deposit"?"Your browser wallet sends USDG to the Stash pool. The deposit is screened, then becomes a private note only you can spend. 0.15% deposit fee.":dialog.kind==="withdraw"?"A proof made on this device moves USDG out to the address above. 0.25% withdrawal fee plus a $0.25 relayer fee.":"Reserves the tin size plus 0.15% + $0.20 and gas at cost (about $1), plus a $0.25 relayer fee. The proof is made on this device and can take a little while."):dialog.kind==="allocate"?"This saves a funding instruction in your browser. Live USDG funding, gas and marketplace settlement are not connected.":dialog.kind==="gift"?"This creates a local draft. Its funds and redemption become available when the live gifting service is connected.":"This updates the local workspace balance. It does not transfer, shield or withdraw real funds."}</div>
      {error&&<p role="alert" className="text-sm text-highlight-secondary">{error}</p>}
      <Action type="submit" className="w-full" disabled={busy}>{busy?"Working…":isLive&&dialog.kind==="deposit"?"Deposit from browser wallet":isLive&&dialog.kind==="withdraw"?"Withdraw":isLive&&dialog.kind==="allocate"?"Request tin":isLive&&dialog.kind==="gift"?"Fund gift tin":dialog.kind==="allocate"?<>Save tin funding plan <PixelIcon name="arrow" className="size-4"/></>:dialog.kind==="gift"?<>Save gift draft <PixelIcon name="arrow" className="size-4"/></>:<>Save workspace entry <PixelIcon name="arrow" className="size-4"/></>}</Action>
    </form>}
    {dialog.kind==="wallet"&&error&&<p role="alert" className="mt-4 text-sm leading-copy text-highlight-secondary">{error}</p>}
  </Modal>;
}
