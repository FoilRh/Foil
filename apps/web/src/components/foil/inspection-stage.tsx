"use client";
import {PixelIcon} from "@/components/ui/pixel-icon";
import {ScanImage} from "./scan-image";
import {animated,useSpring} from "@react-spring/web";
import {useCallback,useEffect,useRef,useState,type PointerEvent} from "react";
import type {Collectible} from "@/data/foil-catalog";

export function InspectionStage({product,expanded,onExpand}:{product:Collectible;expanded:boolean;onExpand:()=>void}){
  const [side,setSide]=useState<"front"|"back">("front");
  const [zoom,setZoom]=useState(1);
  const [pan,setPan]=useState({x:0,y:0});
  const [tilt,setTilt]=useState(false);
  const [angle,setAngle]=useState({x:0,y:0});
  const pointer=useRef<{x:number;y:number;panX:number;panY:number}|null>(null);
  const touches=useRef(new Map<number,{x:number;y:number}>());
  const pinch=useRef<{distance:number;zoom:number}|null>(null);
  const stage=useRef<HTMLDivElement>(null);
  const clampPan=useCallback((next:{x:number;y:number},scale:number)=>{
    const viewport=stage.current;if(!viewport)return{x:0,y:0};
    const image=viewport.querySelector("img");
    const limitX=Math.max(0,((image?.offsetWidth??viewport.clientWidth)*scale-viewport.clientWidth)/2);
    const limitY=Math.max(0,((image?.offsetHeight??viewport.clientHeight)*scale-viewport.clientHeight)/2);
    return{x:Math.max(-limitX,Math.min(limitX,next.x)),y:Math.max(-limitY,Math.min(limitY,next.y))};
  },[]);
  const changeZoom=useCallback((next:number)=>{const scale=Math.max(1,Math.min(4,next));setZoom(scale);setPan(value=>clampPan(value,scale));},[clampPan]);
  const spring=useSpring({scale:zoom,x:pan.x,y:pan.y,rotateX:tilt?angle.x:0,rotateY:tilt?angle.y:0,config:{tension:300,friction:30}});
  useEffect(()=>{const el=stage.current;const wheel=(e:WheelEvent)=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();const next=Math.max(1,Math.min(4,zoom-e.deltaY*.008));changeZoom(next);};el?.addEventListener("wheel",wheel,{passive:false});return()=>el?.removeEventListener("wheel",wheel);},[zoom,changeZoom]);
  function reset(){changeZoom(1);setAngle({x:0,y:0});}
  function down(e:PointerEvent<HTMLDivElement>){e.currentTarget.setPointerCapture(e.pointerId);touches.current.set(e.pointerId,{x:e.clientX,y:e.clientY});pointer.current={x:e.clientX,y:e.clientY,panX:pan.x,panY:pan.y};if(touches.current.size===2){const [a,b]=[...touches.current.values()];pinch.current={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom};}}
  function move(e:PointerEvent<HTMLDivElement>){
    if(touches.current.has(e.pointerId))touches.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(touches.current.size===2&&pinch.current){const[a,b]=[...touches.current.values()];changeZoom(pinch.current.zoom*Math.hypot(a.x-b.x,a.y-b.y)/pinch.current.distance);return;}
    if(pointer.current&&zoom>1)setPan(clampPan({x:pointer.current.panX+e.clientX-pointer.current.x,y:pointer.current.panY+e.clientY-pointer.current.y},zoom));
    else if(tilt){const r=e.currentTarget.getBoundingClientRect();setAngle({x:-(e.clientY-r.top-r.height/2)/r.height*18,y:(e.clientX-r.left-r.width/2)/r.width*24});}
  }
  function up(e:PointerEvent<HTMLDivElement>){touches.current.delete(e.pointerId);pinch.current=null;pointer.current=null;}
  const image=side==="back"&&product.backImage?product.backImage:product.image;
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="mb-3 flex items-center justify-between gap-2"><div role="group" aria-label="Card side" className="flex rounded-lg border border-foreground/15 p-1"><button type="button" onClick={()=>{setSide("front");reset();}} aria-pressed={side==="front"} className={`min-h-11 rounded-md px-4 text-xs ${side==="front"?"bg-accent text-on-inverse":"text-foreground-subtle"}`}>Front</button><button type="button" onClick={()=>{setSide("back");reset();}} disabled={!product.backImage} aria-pressed={side==="back"} className={`min-h-11 rounded-md px-4 text-xs disabled:opacity-30 ${side==="back"?"bg-accent text-on-inverse":"text-foreground-subtle"}`}>Back</button></div><div className="flex gap-1"><button type="button" aria-label="Tilt inspection" aria-pressed={tilt} onClick={()=>setTilt(!tilt)} className={`min-h-11 rounded-lg border px-3 text-xs ${tilt?"border-accent text-accent":"border-foreground/15"}`}><span className="sr-only">Tilt</span><PixelIcon name="tilt"/></button><button type="button" aria-label={expanded?"Exit expanded view":"Expand inspection"} onClick={onExpand} className="flex size-11 items-center justify-center rounded-lg border border-foreground/15 text-xl"><PixelIcon name="expand"/></button></div></div>
    <div ref={stage} role="img" aria-label={`${product.name}, ${side} scan at ${Math.round(zoom*100)} percent. Double-click to zoom; drag to pan.`} tabIndex={0} onKeyDown={e=>{if(e.key==="+"||e.key==="="){e.preventDefault();changeZoom(zoom+.5);}if(e.key==="-"){e.preventDefault();changeZoom(zoom-.5);}if(e.key==="0")reset();}} onDoubleClick={()=>changeZoom(zoom===1?2:1)} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={()=>{if(!pointer.current)setAngle({x:0,y:0});}} className={`relative flex min-h-0 shrink-0 touch-none items-center justify-center overflow-hidden rounded-xl perspective-[var(--inspection-perspective)] border border-foreground/10 bg-display-surface bg-(image:--display-gradient) p-6 outline-none focus-visible:ring-2 focus-visible:ring-accent mobile:min-h-72 mobile:p-4 ${expanded?"h-[var(--inspection-expanded)]":"h-[var(--inspection-height)]"} ${zoom>1?"cursor-grab active:cursor-grabbing":"cursor-zoom-in"}`}>
      <animated.div style={spring} className="relative flex h-full w-full items-center justify-center will-change-transform"><ScanImage key={image} src={image} preview={side==="back"?product.backThumbnail:product.thumbnail} alt={`${product.name} — original ${side} slab scan`}/></animated.div>
      <span aria-hidden className="pointer-events-none absolute right-3 bottom-3 rounded-md bg-display-ink/80 px-2 py-1 text-xs text-display-surface">{Math.round(zoom*100)}%</span>
    </div>
    <div className="mt-3 flex items-center justify-between gap-3"><button type="button" aria-label="Zoom out" disabled={zoom<=1} onClick={()=>changeZoom(zoom-.5)} className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-foreground/20 text-xl disabled:opacity-30"><PixelIcon name="minus"/></button><label className="flex flex-1 items-center gap-3"><span className="sr-only">Inspection zoom</span><input aria-label="Inspection zoom" type="range" min="1" max="4" step=".05" value={zoom} onChange={e=>changeZoom(Number(e.target.value))} className="min-h-11 w-full accent-accent"/></label><button type="button" aria-label="Zoom in" disabled={zoom>=4} onClick={()=>changeZoom(zoom+.5)} className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-foreground/20 text-xl disabled:opacity-30"><PixelIcon name="plus"/></button><button type="button" onClick={reset} className="min-h-11 px-2 text-xs text-foreground-subtle">Reset</button></div>
    <p className="mt-1 text-center text-xs leading-copy text-foreground-subtle">Double-click to zoom · Drag to pan · Pinch on mobile{!product.backImage&&" · Front image available"}</p>
  </div>;
}
