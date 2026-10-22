export interface NavLink { label: string; href: string; active?: boolean }
export interface CtaLink { label: string; href: string }
export interface Stat { label: string; value: string }

/** Foil content from the supplied Overview and Build. No invented live metrics. */
export const homeContent = {
  header: {
    brand: "FOIL", locale: "RHC",
    nav: [{label:"Protocol",href:"#process"},{label:"Collection",href:"#vault",active:true},{label:"Privacy",href:"#record"},{label:"FAQs",href:"#questions"}] satisfies NavLink[],
    login:{label:"My Stash",href:"/dashboard?tab=stash"},
    cta:{label:"Open Foil",href:"/dashboard"},
  },
  hero:{
    eyebrow:"private collecting · your keys",
    titleLine1:"Your cards",titleLine2:"your",titleMark:"rules",
    lead:["Collect from a shielded Stash. Every rip lands in a fresh wallet, and you decide","what anyone else gets to see."] as const,
    cta:{label:"Enter your Stash",href:"/dashboard"},image:"/assets/hero/hero-vault.png",
  },
  intro:{
    statement:"A pack is yours to open. A pull is yours to keep. Foil brings shielded balances, fresh wallets and private routing to your collection. ",
    statementAccent:"Your cards. Your business.",
    cta:{label:"See how it works",href:"#process"},
    aside:"Public wallets turn collecting into a public history. Foil separates your funding balance from each pull, so your collection does not have to become your profile.",
    tags:["Shielded Stash","Single-use wallets","Your keys","Optional sharing"],
    cards:{left:{src:"/assets/intro/intro-card-tucked-overlay.png",alt:"Gengar VMAX 002/019 Japanese card in its authentic PSA 9 slab"},tucked:{src:"/assets/intro/intro-card-tucked.png",alt:"Journey Together sealed Pokémon booster pack"},front:{src:"/assets/intro/intro-card-front.png",alt:"Surging Sparks sealed Pokémon booster pack with Pikachu artwork"}},
  },
  process:{
    eyebrow:"the protocol",titleLine1:"From your Stash",titleLine2:"to a",struck:"trail",mark:"tin",ghost:"protocol",
    steps:[
      {number:"01",title:"Shield your Stash",text:"USDG enters a screened, shielded balance. You keep control of the keys and can withdraw your Stash.",stats:[{label:"Balance",value:"USDG"},{label:"Control",value:"Yours"}]},
      {number:"02",title:"Join the round",text:"Tins are funded in shared rounds on a 10-minute cadence; small rounds may wait up to 30 minutes. USDG and gas arrive together.",stats:[{label:"Cadence",value:"10 min"},{label:"Funding",value:"Shared"}]},
      {number:"03",title:"Open a fresh tin",text:"Each pull gets a new single-use wallet. Your card stays in its own tin, ready to keep or send back.",stats:[{label:"Wallets",value:"1 / rip"},{label:"Keys",value:"Local"}]},
      {number:"04",title:"Choose what shows",text:"Gift a pack, keep your pull or share a hit under a season handle. Posting is always your choice.",stats:[{label:"Sharing",value:"Opt-in"},{label:"Limits",value:"On"}]},
    ] satisfies Array<{number:string;title:string;text:string;stats:Stat[]}>,
  },
  vault:{
    eyebrow:"collect on your terms",title:"Always",mark:"yours",ghost:"collect",
    lead:"Tokenized trading cards across Pokémon TCG, One Piece, sports and more. Each pull lives in its own tin; sharing a hit reveals only the tin you choose.",
    cards:[{"src": "/assets/vault/vault-card-1.png", "alt": "Paradox Rift Booster Pack"}, {"src": "/assets/vault/vault-card-2.png", "alt": "Bulbasaur 001/165 Japanese Pokemon 151 Master Ball Reverse Holo PSA 10"}, {"src": "/assets/vault/vault-card-3.png", "alt": "Terastal Festival ex Booster Pack"}, {"src": "/assets/vault/vault-card-4.png", "alt": "[PSA 10] Espeon 062/187 Terastal Festival Master Ball Reverse Japanese POKEMON"}, {"src": "/assets/vault/vault-card-5.png", "alt": "Vstar Universe Japanese Booster Pack"}],
    stats:[{label:"Asset",value:"USDG"},{label:"Round",value:"10 min"},{label:"Wallet",value:"Fresh"},{label:"Keys",value:"Yours"}],
    cta:{label:"View your collection",href:"/dashboard?tab=tins"},
  },
  drop:{
    eyebrow:"one pull at a time",title:"Rip",mark:"one tin",
    points:["A single-use wallet for each pull. Funded from your shielded Stash in a shared round, with gas already inside.","Keep the card in its tin, sell back when eligible, or draft a gift. Export your tin records whenever you choose."],
    shelf:"One wallet per pull  ·  ",price:"Your keys",card:{src:"/assets/drop/drop-card.png",alt:"Iono’s Wattrel SV-P 232 promo in its authentic BGS 9.5 slab"},
  },
  record:{
    eyebrow:"privacy in the architecture",ghost:"privacy",titleLine1:"You choose",titleLine2:"what is",mark:"shown",
    insured:{label:"Shared funding rounds",value:"10 MIN"},vaulted:{label:"Wallets per pull",value:"ONE"},audits:{label:"Proofs run",value:"LOCAL"},lost:{label:"Key custody",value:"YOU"},
    log:[
      {date:"01 / STASH",title:"A shielded USDG pool separates deposits from tins",ref:"SHIELDED",stamp:"Private"},
      {date:"02 / TINS",title:"Fresh wallets receive USDG and gas together",ref:"SINGLE-USE",stamp:"Fresh"},
      {date:"03 / ROUTE",title:"Request relays reduce IP and request linking",ref:"OHTTP",stamp:"Routed"},
      {date:"04 / KEYS",title:"Proofs and key control stay on your device",ref:"ON-DEVICE",stamp:"Yours"},
    ],
  },
  questions:{
    eyebrow:"know what stays private",titleLine1:"Ask us",titleLine2:"the hard",mark:"stuff",ghost:"ask",
    note:"Privacy works best when its limits are clear. Explore the architecture or read the full overview before collecting.",
    items:[
      {question:"What does Foil keep private?",answer:"Foil separates your shielded USDG balance from the single-use wallets that hold each pull. Tins and their onchain activity remain public; Foil is designed to conceal which tins belong to you. Small or unusual funding rounds offer less cover."},
      {question:"What is a tin?",answer:"A tin is an ordinary single-use wallet created for a pull. It receives USDG and gas together in a shared funding round. The wallet holds the pulled card, and you control its key."},
      {question:"Where are the physical cards?",answer:"The partner marketplace vaults the physical cards represented by its tokens. Foil provides the wallet and privacy flow. Redemption and shipping remain subject to that marketplace's terms; Foil is not a grading or vaulting company."},
      {question:"What happens when I share or ship?",answer:"A posted hit links that specific tin to your season handle. Redeeming a card links the tins you ship from to the identity supplied to the marketplace. A gift-card transfer is visible as a hand-off between two tins."},
      {question:"Can I use the dashboard right now?",answer:"Yes. Open the dashboard and start exploring Foil."},
    ],
  },
  join:{
    eyebrow:"keep collecting close",titleLine1:"Your next pull",titleLine2:"starts with",mark:"Foil",ghost:"yours",
    card:{src:"/assets/join/join-card.png",alt:"Pokémon Card 151 sealed booster pack"},
  },
  footer:{
    brand:"FOIL",address:"Shielded USDG · Robinhood Chain",
    columns:[{title:"Your Foil",links:["Stash","Tins","Gifts"]},{title:"Protocol",links:["Overview","Build notes","Privacy"]},{title:"Explore",links:["Collection","FAQs","Local storage"]}],
    copyright:"© 2026 FOIL",legal:"Your cards. Your business.",
  },
} as const;
export type HomeContent=typeof homeContent;
