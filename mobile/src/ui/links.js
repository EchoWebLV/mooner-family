// A coin's links as the screens offer them: a plain function of its `token` (no React Native,
// so Node tests run it).

const LINKS = [["twitter", "X"], ["telegram", "Telegram"], ["website", "Website"]];

/** The coin's links that are there, as [{ label, url }]: https only. */
export function linksOf(token) {
  const links = token?.links ?? {};
  return LINKS.filter(([k]) => typeof links[k] === "string" && /^https:\/\/\S+$/i.test(links[k].trim()))
    .map(([k, label]) => ({ label, url: links[k].trim() }));
}
