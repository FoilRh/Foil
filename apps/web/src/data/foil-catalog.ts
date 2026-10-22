import premium from "./foil-premium-catalog.json";
export type Category="Pokémon"|"One Piece"|"Sports"|"Sealed packs"|"Other collectibles";
export interface Collectible {
  id:string; name:string; detail:string; kind:"pack"|"slab"|"tin"|"unavailable"; image:string;thumbnail?:string; backImage?:string;backThumbnail?:string;tinId?:string;
  grade?:string; grader?:string; certification?:string; year?:number; category:Category;
  sourcePage?:string; language?:string;
}
const packs:Collectible[]=[
  {id:"pack-01",name:"Mega Brave",detail:"Japanese · Booster pack",kind:"pack",image:"/assets/foil/catalog/pack-01.png",category:"Sealed packs",language:"Japanese"},
  {id:"pack-02",name:"Battle Partners",detail:"Japanese · Booster pack",kind:"pack",image:"/assets/foil/catalog/pack-02.png",category:"Sealed packs",language:"Japanese"},
  {id:"pack-03",name:"The Glory of Team Rocket",detail:"Japanese · Booster pack",kind:"pack",image:"/assets/foil/catalog/pack-03.png",category:"Sealed packs",language:"Japanese"},
  {id:"pack-04",name:"Inferno X",detail:"Japanese · Booster pack",kind:"pack",image:"/assets/foil/catalog/pack-04.png",category:"Sealed packs",language:"Japanese"},
];
const legacy:Collectible[]=[
  {id:"slab-01",name:"Pikachu",detail:"020/M-P · McDonald’s promo",kind:"slab",image:"/assets/foil/catalog/slab-01.png",grade:"BGS 9.5",category:"Pokémon"},
  {id:"slab-02",name:"Sylveon ex",detail:"069/187 · Terastal Festival",kind:"slab",image:"/assets/foil/catalog/slab-02.png",grade:"PSA 9",category:"Pokémon"},
  {id:"slab-03",name:"Jolteon ex",detail:"052/187 · Terastal Festival",kind:"slab",image:"/assets/foil/catalog/slab-03.png",grade:"PSA 10",category:"Pokémon"},
  {id:"slab-04",name:"Leafeon GX",detail:"067/066 · Ultra Sun",kind:"slab",image:"/assets/foil/catalog/slab-04.png",grade:"PSA 9",category:"Pokémon"},
];
export const collectibles:Collectible[]=[...premium.map(p=>({...p,grade:`${p.grader} ${p.grade}`,kind:"slab" as const,category:p.category as Category})),...packs];
const unassigned:Collectible={id:"tin-unassigned",name:"Fresh pack tin",detail:"Budget reserved for a future pack rip. No card or machine has been selected.",kind:"tin",image:"/assets/foil/fresh-tin.svg",category:"Other collectibles"};
export const getCollectible=(id:string):Collectible=>[...collectibles,...legacy,unassigned].find(p=>p.id===id)??{id,name:"Collectible details unavailable",detail:"The original asset is not in this catalogue. Its tin record is preserved.",kind:"unavailable",image:"/assets/foil/unavailable-card.svg",category:"Other collectibles"};
export const categories:Category[]=["Pokémon","One Piece","Sports","Sealed packs"];

/** Pack artwork is a visual reference; it does not select a machine or a pull. */
export function getTinCollectible(tin:{productId:string;referenceProductId?:string}):Collectible{
  const product=getCollectible(tin.productId);
  if(product.kind!=="tin"||!tin.referenceProductId)return product;
  const reference=getCollectible(tin.referenceProductId);
  if(reference.kind!=="pack")return product;
  return {...product,image:reference.image,thumbnail:reference.thumbnail,detail:`${reference.name} pack artwork · Budget reserved for a future rip.`};
}
