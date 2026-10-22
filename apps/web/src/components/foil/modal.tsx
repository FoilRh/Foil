"use client";

import {PixelIcon} from "@/components/ui/pixel-icon";
import { animated, useSpring } from "@react-spring/web";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref=useRef<HTMLDialogElement>(null);
  const id=useId();
  const style=useSpring({from:{opacity:0,y:18},to:{opacity:1,y:0},config:{tension:310,friction:29}});
  useEffect(()=>{
    const dialog=ref.current;
    dialog?.showModal();
    return ()=>dialog?.close();
  },[]);
  return <dialog ref={ref} aria-labelledby={id} onCancel={(e)=>{e.preventDefault();onClose();}} onClick={(e)=>{if(e.target===e.currentTarget)onClose();}} className={`foil-dashboard m-auto rounded-xl max-h-[var(--overlay-height)] w-[var(--overlay-width)] overflow-y-auto border border-accent/40 bg-surface bg-(image:--panel-gradient) p-0 text-foreground shadow-2xl backdrop:bg-background/85 ${wide?"max-w-3xl":"max-w-lg"}`} data-lenis-prevent>
    <animated.div style={style} className="p-7 mobile:p-5">
      <div className="mb-6 flex items-start justify-between gap-5">
        <h2 id={id} className="type-display whitespace-normal text-3xl leading-display text-foreground">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close dialog" className="flex size-11 shrink-0 items-center justify-center border border-foreground/25 text-xl hover:border-accent hover:text-accent"><PixelIcon name="close"/></button>
      </div>
      {children}
    </animated.div>
  </dialog>;
}
