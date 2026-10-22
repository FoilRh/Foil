"use client";
import {useEffect} from "react";
import {collectibles} from "@/data/foil-catalog";
import {warmCollectible,warmImage} from "@/lib/foil-image-cache";

export function DashboardImagePrefetch(){
  useEffect(()=>{
    function preload(event:Event){const target=event.target;if(!(target instanceof Element)||!target.closest('a[href*="/dashboard"]'))return;collectibles.forEach(p=>warmImage(p.thumbnail??p.image));if(collectibles[0])warmCollectible(collectibles[0]);}
    document.addEventListener("pointerover",preload);document.addEventListener("focusin",preload);
    return()=>{document.removeEventListener("pointerover",preload);document.removeEventListener("focusin",preload);};
  },[]);
  return null;
}
