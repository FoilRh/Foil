import {GiftView} from "@/views/gift";
// Gift links carry a key in the fragment: keep this page out of search and referrers.
export const metadata={title:"A gift for you | Foil",description:"Claim a Foil gift into your own Stash.",robots:{index:false,follow:false},referrer:"no-referrer" as const};
export default function GiftPage(){return <GiftView/>;}
