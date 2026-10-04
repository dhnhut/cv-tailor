// Where to go after sign-in: the page that asked for it. oidc-client-ts keeps this state in session
// storage and puts only a random ID in the URL, so a link can't set it. Still, only a path on this
// site is accepted: "//evil.com" or "/\evil.com" would leave the site.
export function returnPath(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'returnTo' in state) {
    const { returnTo } = state;
    if (typeof returnTo === 'string' && /^\/(?![/\\])/.test(returnTo)) return returnTo;
  }
  return '/';
}
