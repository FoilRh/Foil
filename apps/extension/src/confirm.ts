/** Confirmation window: shows what the request does ("−$25.00 USDG, +1 card"), then answers. */
const q = new URLSearchParams(location.search);
const id = Number(q.get("id"));
document.getElementById("site")!.textContent = q.get("o") ?? "";
document.getElementById("summary")!.textContent = q.get("s") ?? "";

let answered = false;
const answer = (approved: boolean) => {
  if (answered) return;
  answered = true;
  void chrome.runtime.sendMessage({ type: "confirm-result", id, approved }).finally(() => window.close());
};
document.getElementById("approve")!.addEventListener("click", () => answer(true));
document.getElementById("reject")!.addEventListener("click", () => answer(false));
window.addEventListener("beforeunload", () => answer(false));
