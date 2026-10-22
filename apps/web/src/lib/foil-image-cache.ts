import type {Collectible} from "@/data/foil-catalog";
const requested=new Set<string>();
/** Normal browser cache only; no storage of keys, wallet data or external URLs. */
export function warmImage(src:string){
  if(typeof window==="undefined"||requested.has(src)||!src.startsWith("/assets/"))return;
  requested.add(src);
  const image=new window.Image();image.decoding="async";image.fetchPriority="low";image.src=src;
}
export function warmCollectible(product:Collectible){if(product.thumbnail)warmImage(product.thumbnail);if(product.backThumbnail)warmImage(product.backThumbnail);warmImage(product.image);if(product.backImage)warmImage(product.backImage);}
