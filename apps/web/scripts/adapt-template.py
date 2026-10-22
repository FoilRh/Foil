from pathlib import Path
import re
import json
import shutil

root=Path(__file__).resolve().parents[1]
def edit(path,fn):
    p=root/path
    p.write_text(fn(p.read_text()))

palette={'#05070b':'#07110d','#07090d':'#09160f','#070a10':'#08140f','#080c11':'#0c1b14','#0c1119':'#11251c','#f2f4f8':'#fff4d9','#e6e7ea':'#eeddb5','#d5dae3':'#d4d6be','#c9d0db':'#c3c8ad','#8f98a8':'#a0aa96','#4a8cff':'#fcd47c','#2a63f0':'#99712e','#ededed':'#efe7d0'}
def theme(s):
    for before,after in palette.items():s=s.replace(before,after)
    s=s.replace('rgb(7 10 16 /','rgb(8 20 15 /').replace('rgb(8 12 17 /','rgb(12 27 20 /')
    s=s.replace('--raw-color-white: #ffffff;','--raw-color-white: #fff4d9;\n  /* Foil overlays and dashboard, fitted to the retained template. */\n  --raw-size-overlay-height: 85svh;\n  --raw-size-overlay-width: calc(100% - 2rem);\n  --raw-color-plum-400: #aa7c9b;')
    s=s.replace('/* The design is dark-only','--overlay-height: var(--raw-size-overlay-height);\n  --overlay-width: var(--raw-size-overlay-width);\n  --highlight-secondary: var(--raw-color-plum-400);\n  /* The design is dark-only')
    s=s.replace('--color-accent:', '--color-highlight-secondary: var(--highlight-secondary);\n  --color-accent:')
    s+='\n@layer base {\n  :focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }\n  html { scroll-padding-top: 6rem; }\n  button, a, summary { -webkit-tap-highlight-color: transparent; }\n}\n@layer utilities {\n  .pixel-art { image-rendering: pixelated; }\n}\n'
    return s
edit(Path('src/app/globals.css'),theme)

def header(s):
    s='import Image from "next/image";\nimport { SocialLinks } from "@/components/foil/social-links";\n'+s
    s=re.sub(r'<span className="flex items-center justify-center desktop:absolute.*?</span>', '<span className="flex items-center justify-center desktop:absolute desktop:top-0 desktop:left-3"><Image src="/assets/foil/logo-pikachu.png" alt="" width={56} height={56} className="pixel-art size-12 object-contain" /></span>',s,count=1,flags=re.S)
    s=s.replace('desktop:left-13 desktop:', 'desktop:left-17 desktop:')
    start=s.index('      <button\n')
    end=s.index('      </button>',start)+len('      </button>')
    s=s[:start]+'      <div className="hidden desktop:absolute desktop:top-3 desktop:left-66 desktop:flex"><SocialLinks /></div>'+s[end:]
    return s
edit(Path('src/views/home/site-header.tsx'),header)

def footer(s):
    s='import { SocialLinks } from "@/components/foil/social-links";\n'+s
    s=s.replace('const COLUMN_LEFT', 'const FOOTER_LINKS: Record<string,string> = {Stash:"/dashboard?tab=stash",Tins:"/dashboard?tab=tins",Gifts:"/dashboard?tab=gifts",Overview:"/docs/foil-overview.pdf","Build notes":"/docs/foil-build.pdf",Privacy:"/#record",Collection:"/#vault",FAQs:"/#questions","Local storage":"/privacy-policy"};\n\nconst COLUMN_LEFT')
    s=s.replace('href="#"','href={FOOTER_LINKS[link] ?? "/dashboard"}')
    s=s.replace('    <MotionSlot\n      kind="wordmark"', '    <div className="desktop:absolute desktop:top-29 desktop:left-19"><SocialLinks /></div>\n\n    <MotionSlot\n      kind="wordmark"')
    return s
edit(Path('src/views/home/site-footer.tsx'),footer)
edit(Path('src/components/menu/menu-poster.tsx'),lambda s:s.replace('<button type="button" className="text-on-inverse/60">','<span className="text-on-inverse/60">').replace('{locale}\n                  </button>','{locale}\n                  </span>'))
edit(Path('src/views/home/join-section.tsx'),lambda s:re.sub(r'    <form\n.*?    </form>','    <JoinForm placeholder={emailPlaceholder} cta={cta} />',s,flags=re.S).replace('import { PlateButton } from "@/components/ui/plate-button";','import { JoinForm } from "@/components/foil/join-form";'))
edit(Path('src/components/preloader/preloader.tsx'),lambda s:s.replace('card custody · zug','private collecting · your keys'))
# Preserve the animation and design boxes but let authentic art retain its own ratio.
edit(Path('src/components/ui/card-image.tsx'),lambda s:s.replace('imageClassName = "object-cover"','imageClassName = "object-contain pixel-art"').replace('className={cx("absolute", crop)}','className="absolute inset-0"').replace('className="object-cover"','className="object-contain pixel-art"'))

def config(s):
    s=s.replace('const nextConfig: NextConfig = {','const nextConfig: NextConfig = {\n  output: "export",\n  trailingSlash: true,\n  turbopack: { root: process.cwd() },')
    s=s.replace('images: {','images: {\n    unoptimized: true,')
    return s
edit(Path('next.config.ts'),config)
# A frontend-only static export cannot run request-rewriting middleware or POST routes.
archive=root/'scripts'/'template-server-only'
archive.mkdir(exist_ok=True)
for rel in ['src/proxy.ts','src/app/api/contact/route.ts']:
    p=root/rel
    if p.exists():shutil.move(str(p),archive/(p.parent.name+'-'+p.name+'.reference'))

def site(s):
    s=s.replace('HELD-MINT — Rare cards behind steel','FOIL — Your cards. Your business.').replace('HELD-MINT','FOIL')
    s=s.replace('Rare trading cards bought outright, graded, sealed and stored in a Swiss strongroom in Zug — every shelf, seal and signature published on a public ledger.','Private collecting with a shielded USDG Stash, single-use wallets and keys you control. Explore Foil and organize your collection.')
    s=s.replace('a graded card locked in a steel vault','private collecting on your terms').replace('"http://localhost:3000"','"https://foil-private-collecting.sleroy1312.chatgpt.site"').replace('"#070a10"','"#08140f"')
    return s
edit(Path('src/lib/site.ts'),site)
hosting=json.loads((root/'.openai/hosting.json').read_text())
hosting['static']={'directory':'out'}
(root/'.openai/hosting.json').write_text(json.dumps(hosting,indent=2)+'\n')
(root/'public/docs').mkdir(exist_ok=True)
for name,dest in [('Foil Overview (1).pdf','foil-overview.pdf'),('Foil Build (1).pdf','foil-build.pdf')]:
    shutil.copy2(Path('/Users/justinleroy/Downloads')/name,root/'public/docs'/dest)
print('Foil copy, theme, navigation and static configuration applied.')
