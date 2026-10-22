import {PixelIcon} from "@/components/ui/pixel-icon";

/** Foil's official channels. Each opens in a new tab and sends no referrer. */
const socials=[
  {name:"Telegram",icon:"telegram",href:"https://t.me/foilprivacyonrobinhood"},
  {name:"GitHub",icon:"github",href:"https://github.com/FoilRh/Foil"},
  {name:"X",icon:"x",href:"https://x.com/FoilPrivacy"},
] as const;

export function SocialLinks({channels,labels=false}:{channels?:readonly string[];labels?:boolean}={}){
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Foil social channels">
      {socials.filter(s=>!channels||channels.includes(s.name)).map(s=>(
        <a key={s.name} href={s.href} target="_blank" rel="noopener noreferrer" aria-label={`Foil on ${s.name}`} title={`Foil on ${s.name}`} className={`pixel-control flex min-h-11 items-center justify-center gap-3 ${labels?"rounded-lg border border-foreground/25 px-5":"size-11"} text-foreground/75 transition-colors duration-[var(--duration-hover)] ease-entrance hover:text-accent focus-visible:outline-2 focus-visible:outline-accent`}>
          <PixelIcon name={s.icon}/>{labels&&<span className="type-caps text-lg">Follow on {s.name}</span>}
        </a>
      ))}
    </div>
  );
}
