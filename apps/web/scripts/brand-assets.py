from pathlib import Path
from PIL import Image, ImageDraw, ImageOps
import numpy as np

root=Path(__file__).resolve().parents[1]
out=root.parents[1]
pub=root/'public'
original=root.parent/'held-mint/public'
R=Image.Resampling.NEAREST

logo=Image.open(out/'manual_edit/v21-logo-foreground.png').convert('RGBA')
logo=logo.crop(logo.getbbox())
logo.save(pub/'assets/foil/logo-pikachu.png')
icon=Image.new('RGBA',(512,512))
small=logo.copy();small.thumbnail((460,460),R)
icon.alpha_composite(small,((512-small.width)//2,(512-small.height)//2))
for name,size in [('icon-512x512.png',512),('icon-maskable-512x512.png',512),('apple-icon-180x180.png',180),('android-icon-192x192.png',192),('favicon-16x16.png',16)]:icon.resize((size,size),R).save(pub/name)
icon.resize((64,64),R).convert('RGBA').save(pub/'favicon.ico',sizes=[(16,16),(32,32),(64,64)])
icon.resize((64,64),R).convert('RGBA').save(root/'src/app/favicon.ico',sizes=[(16,16),(32,32),(64,64)])

def gold_green(im):
    rgb=np.array(im.convert('RGB')).astype(float)
    lum=(rgb[:,:,0]*.2126+rgb[:,:,1]*.7152+rgb[:,:,2]*.0722)/255
    low=np.array([5,15,10]);high=np.array([245,218,160])
    color=low+(high-low)*lum[:,:,None]**1.04
    # Preserve metallic highlights; tint the low-mid reflections muted plum.
    tint=np.maximum(0,1-np.abs(lum-.22)/.14)[:,:,None]
    color+=tint*np.array([8,-2,8])
    return Image.fromarray(np.clip(color,0,255).astype('uint8'))

hero=Image.open(original/'assets/hero/hero-vault.png').convert('RGB')
size=hero.size
hero=gold_green(hero).convert('RGBA')
occlusion=hero.copy()
# This rectangle is the existing NFT's printed area, inside its original frame.
sx=size[0]/1376;sy=size[1]/768
def box(values):return tuple(round(v*(sx if i%2==0 else sy)) for i,v in enumerate(values))
rect=box((523,171,786,521))
d=ImageDraw.Draw(hero)
d.rounded_rectangle(rect,radius=round(5*sx),fill=(11,23,17,255))
slab=Image.open(pub/'assets/foil/hero-slab.png').convert('RGBA')
slab=slab.crop(slab.getbbox())
slab.thumbnail((rect[2]-rect[0]-round(12*sx),rect[3]-rect[1]-round(12*sy)),Image.Resampling.LANCZOS)
hero.alpha_composite(slab,(round((rect[0]+rect[2]-slab.width)/2),round((rect[1]+rect[3]-slab.height)/2)))
# Retain the original safe's foreground dial, which physically overlaps the card.
mask=Image.new('L',size)
ImageDraw.Draw(mask).ellipse(box((766,283,925,434)),fill=255)
hero=Image.composite(occlusion,hero,mask)
hero=hero.convert('RGB').resize((1280,715),R).quantize(colors=192,dither=Image.Dither.NONE).resize(size,R)
hero.save(pub/'assets/hero/hero-vault.png',optimize=True)
hero.convert('RGB').resize((1376,768),R).save(root.parent/'assets-work/hero-foil-preview.png')

for directory in ['shared','drop','record']:
    for p in (original/'assets'/directory).glob('*.png'):
        if p.name == 'drop-card.png': continue
        # Retain the exact wire/ring silhouettes and their motion, retinted and pixel-textured.
        im=Image.open(p).convert('RGBA')
        a=im.getchannel('A')
        recolor=gold_green(im).convert('RGBA');recolor.putalpha(a)
        small_size=(max(1,im.width//2),max(1,im.height//2))
        recolor=recolor.resize(small_size,R).resize(im.size,R)
        recolor.save(pub/'assets'/directory/p.name,optimize=True)
for p in (pub/'assets').rglob('*.svg'):
    s=p.read_text()
    for c in ['#4A8CFF','#4a8cff','#2A63F0','#2a63f0']:s=s.replace(c,'#FCD47C' if '4a8c' in c.lower() else '#99712E')
    p.write_text(s)
og=Image.new('RGB',(1200,630),(8,20,15))
bg=hero.convert('RGB').resize((1200,670),Image.Resampling.LANCZOS)
og.paste(bg,(0,-20));og.save(pub/'open-graph.png')
print('Transparent Pikachu mark, authentic hero slab, and Foil image palette prepared.')
