const KEY_PREFIX = "story-chain:player:";

// sessionStorage, not localStorage: identity has to be per-tab. localStorage
// is shared across every tab of the same origin, so a host and a
// participant testing/playing in two tabs of the same browser would
// overwrite each other's stored player id for the same game code - whoever
// joined/created most recently wins, and refreshing either tab then loads
// the wrong identity. sessionStorage is scoped to the tab, survives a
// refresh, and isolates tabs from each other, at the cost of not surviving
// an actual tab close (see README's known rough edges).
export function savePlayerIdentity(code: string, playerId: string) {
  sessionStorage.setItem(KEY_PREFIX + code.toUpperCase(), playerId);
}

export function getPlayerIdentity(code: string): string | null {
  return sessionStorage.getItem(KEY_PREFIX + code.toUpperCase());
}
