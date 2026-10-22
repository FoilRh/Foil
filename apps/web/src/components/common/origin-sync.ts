/**
 * Point the page's absolute URLs at the origin actually serving it (D-035).
 *
 * `siteConfig.url` is fixed at build time (NEXT_PUBLIC_SITE_URL, else
 * Vercel's production domain, else localhost). Served from anywhere else — a
 * local `next start`, a preview, a buyer's own domain — the canonical and
 * share tags would name the wrong host. After hydration (on `load`, then on
 * every head change) it rewrites them to `location.origin` when the two
 * differ — never before: React matches its head tags by URL and would add a
 * second copy of any it can't find. A no-op on the production domain. Crawlers that don't run JS (link previews)
 * still read the build-time value — set NEXT_PUBLIC_SITE_URL for a custom domain.
 */
export const originSyncScript = (builtOrigin: string): string =>
  `(function(b){try{var o=location.origin;if(!b||o===b)return;var s='link[rel="canonical"],meta[property="og:url"],meta[property="og:image"],meta[property="og:image:url"],meta[property="og:image:secure_url"],meta[name="twitter:image"],meta[name="twitter:image:src"]';var k=function(e){return e.tagName+(e.getAttribute("rel")||e.getAttribute("property")||e.getAttribute("name"))};var f=function(){document.querySelectorAll(s).forEach(function(e){var a=e.tagName==="LINK"?"href":"content",v=e.getAttribute(a);if(v&&v.indexOf(b)===0){e.setAttribute(a,o+v.slice(b.length));document.querySelectorAll("[data-os]").forEach(function(d){if(d!==e&&k(d)===k(e))d.remove()});e.setAttribute("data-os","")}})};var g=function(){f();new MutationObserver(f).observe(document.head,{childList:true,subtree:true})};document.readyState==="complete"?g():addEventListener("load",g)}catch(e){}})(${JSON.stringify(builtOrigin)})`;
