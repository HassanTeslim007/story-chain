const KEY_PREFIX = "story-chain:player:";

export function savePlayerIdentity(code: string, playerId: string) {
  localStorage.setItem(KEY_PREFIX + code.toUpperCase(), playerId);
}

export function getPlayerIdentity(code: string): string | null {
  return localStorage.getItem(KEY_PREFIX + code.toUpperCase());
}
