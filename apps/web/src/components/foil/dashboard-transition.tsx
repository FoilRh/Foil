"use client";

import {animated,useSpring} from "@react-spring/web";
import {usePathname,useRouter} from "next/navigation";
import {useEffect,useRef,useState} from "react";
import {PixelIcon} from "@/components/ui/pixel-icon";

/** A reversible spring curtain. Modified clicks and reduced motion use normal links. */
export function DashboardTransition(){
  const router=useRouter();
  const pathname=usePathname();
  const [destination,setDestination]=useState<string|null>(null);
  const navigating=useRef(false);
  const covered=Boolean(destination&&!pathname?.startsWith("/dashboard"));
  const style=useSpring({
    from:{progress:0},progress:covered?1:0,
    config:{tension:250,friction:30,clamp:true},
    onRest:result=>{
      if(!result.finished)return;
      if(result.value.progress===1&&destination&&!navigating.current){navigating.current=true;router.push(destination);}
      if(result.value.progress===0&&destination){navigating.current=false;setDestination(null);}
    },
  });
  useEffect(()=>{
    function enter(event:MouseEvent){
      if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||pathname?.startsWith("/dashboard")||window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
      const target=event.target;
      if(!(target instanceof Element))return;
      const link=target.closest<HTMLAnchorElement>('a[href]');
      if(!link||link.download||(link.target&&link.target!=="_self"))return;
      const url=new URL(link.href,location.origin);
      if(url.origin!==location.origin||!/^\/dashboard\/?$/.test(url.pathname))return;
      event.preventDefault();
      if(navigating.current)return;
      setDestination(url.pathname+url.search+url.hash);
    }
    // Capture before Next's Link handler; it respects the prevented click.
    document.addEventListener("click",enter,true);
    return()=>document.removeEventListener("click",enter,true);
  },[pathname]);
  return <animated.div aria-hidden="true" data-dashboard-transition className="foil-route-shutter fixed inset-0 z-[var(--z-route-transition)] flex items-center justify-center overflow-hidden bg-navigation bg-(image:--navigation-gradient) text-accent" style={{pointerEvents:destination?"auto":"none",opacity:style.progress,transform:style.progress.to(p=>`translateY(${(1-p)*100}%)`)}}>
    <div className="flex flex-col items-center gap-5"><PixelIcon name="tin" className="size-12 text-lavender"/><span className="type-display text-6xl">FOIL</span><span className="text-xs tracking-widest text-peach uppercase">Your private corner</span><div className="h-1 w-32 bg-(image:--dawn-gradient)"/></div>
  </animated.div>;
}
