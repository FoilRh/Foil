/** Protocol constants and API types live in @foil/protocol, shared with the API and services. */
export * from "@foil/protocol";

/** Flip each capability only after its Build §12 acceptance checks pass. */
export const FRONTEND_CAPABILITIES={liveFunding:false,privateBrowser:false,keyMode:false,liveQuotes:false,liveShipping:false} as const;
