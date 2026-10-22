import type {SelectHTMLAttributes} from "react";
import {PixelIcon} from "@/components/ui/pixel-icon";
import {field} from "./dashboard-ui";

/** Keep a native keyboard/touch select; the sprite has a fixed padded inset. */
export function SelectField({children,className="",...props}:SelectHTMLAttributes<HTMLSelectElement>){
  return <span className="relative block"><select {...props} className={`${field} appearance-none pr-11 ${className}`}>{children}</select><PixelIcon name="chevron" className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-lavender"/></span>;
}
