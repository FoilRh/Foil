"use client";
import Image from "next/image";
import {useEffect,useState} from "react";

/** Show the already-displayed preview while the original scan decodes. */
export function ScanImage({src,preview,alt}:{src:string;preview?:string;alt:string}){
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    let active=true;const image=new window.Image();image.decoding="async";
    const finish=()=>{if(active)setReady(true);};
    image.onload=finish;image.src=src;
    return()=>{active=false;image.onload=null;};
  },[src]);
  return <Image src={ready||!preview?src:preview} alt={alt} width={900} height={1350} draggable={false} loading="eager" decoding="sync" className="h-full max-h-full w-auto max-w-full select-none object-contain drop-shadow-xl"/>;
}
