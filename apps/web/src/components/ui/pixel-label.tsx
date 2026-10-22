import {Fragment} from "react";
import {PixelIcon,type PixelIconName} from "./pixel-icon";
const glyphs:Record<string,PixelIconName>={"↗":"external","↙":"arrow","→":"arrow","←":"arrow","↓":"chevron","↑":"chevron","×":"close","+":"plus","☆":"star","★":"star","✓":"check","⧉":"copy","⤢":"expand","◇":"tilt"};
export function PixelLabel({value}:{value:string}){
  return value.split(/([↗↙→←↓↑×+☆★✓⧉⤢◇])/).map((part,i)=>glyphs[part]?<PixelIcon key={i} name={glyphs[part]} className={`size-4 ${part==="←"||part==="↙"||part==="↑"?"rotate-180":""}`}/>:<Fragment key={i}>{part}</Fragment>);
}
