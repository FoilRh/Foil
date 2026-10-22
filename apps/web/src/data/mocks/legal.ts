import type {LegalSection} from "@/views/legal/legal-document";
export const LEGAL_UPDATED="Last updated 18 October 2026";
export const privacyPolicy:{title:string;intro:string;sections:readonly LegalSection[]}={
 title:"Privacy & local storage",
 intro:"This page explains what this Foil frontend saves, what remains on your device, and where its privacy boundaries are.",
 sections:[
  {heading:"What stays in this browser",body:["Your workspace balance entries, tin records, gift drafts, season handle, sharing preferences spending limits and saved collectible favorites are saved in localStorage on this device. They are browser records, not a live shielded pool or funded wallets."]},
  {heading:"Wallet connection",body:["If you choose to connect an installed browser wallet, this frontend asks it for your public account address. It does not request a transaction or spending signature. The displayed address is kept only in the current page session."]},
  {heading:"Analytics and hosting",body:["No analytics or marketing integration is installed. Consent preferences are saved locally. The hosting provider may process normal request information needed to deliver the site, such as IP address and user-agent."]},
  {heading:"Exports and gift drafts",body:["Workspace and tin exports contain the local records displayed in the dashboard. They do not contain private keys. Gift draft links can include their name, note and amount in the URL; treat those draft links as public information. They are not Foil's live shielded claim links."]},
  {heading:"The live protocol design",body:["Foil's proposed shielded Stash, shared funding rounds, single-use tins and private request routing are described in the linked protocol documents. Those protections do not apply to this browser-only workspace. Onchain tin activity remains public, while the architecture aims to conceal the association between a person and their tins.","Posting a hit can link a tin to a season handle. Shipping a card can identify the tins involved. Small funding rounds provide less cover."]},
  {heading:"Your controls",body:["You can export local workspace records from Settings and clear them through your browser's site-storage controls. Clearing storage removes the records from that browser. No workspace records are sent to a Foil backend by this frontend."]},
 ],
};
