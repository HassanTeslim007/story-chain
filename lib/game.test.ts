import { describe, expect, it } from "vitest";
import { GameError, endReasonFor, nextAlivePlayer } from "./game";
import type { Player } from "./types";

function player(overrides: Partial<Player>): Player {
  return {
    id: "p1",
    session_id: "s1",
    name: "Player",
    turn_order: 0,
    is_alive: true,
    is_ai: false,
    turns_taken: 0,
    joined_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("nextAlivePlayer", () => {
  const alice = player({ id: "alice", turn_order: 0 });
  const bob = player({ id: "bob", turn_order: 1 });
  const carol = player({ id: "carol", turn_order: 2 });
  const players = [alice, bob, carol];

  it("returns the next player in turn order", () => {
    expect(nextAlivePlayer(players, "alice")?.id).toBe("bob");
  });

  it("wraps around from the last player to the first", () => {
    expect(nextAlivePlayer(players, "carol")?.id).toBe("alice");
  });

  it("skips eliminated players", () => {
    const withBobDead = [alice, { ...bob, is_alive: false }, carol];
    expect(nextAlivePlayer(withBobDead, "alice")?.id).toBe("carol");
  });

  it("wraps past an eliminated player at the end of the list", () => {
    const withCarolDead = [alice, bob, { ...carol, is_alive: false }];
    expect(nextAlivePlayer(withCarolDead, "bob")?.id).toBe("alice");
  });

  it("wraps back to the after-player themself when they're the sole survivor", () => {
    // Real call sites only reach nextAlivePlayer once resolveEnding has
    // already confirmed >=2 are alive, but the wrap-around search includes
    // the after-player's own slot regardless - it doesn't return null here.
    const onlyAliceAlive = [alice, { ...bob, is_alive: false }, { ...carol, is_alive: false }];
    expect(nextAlivePlayer(onlyAliceAlive, "alice")?.id).toBe("alice");
  });

  it("returns null when literally no one is alive", () => {
    const noneAlive = players.map((p) => ({ ...p, is_alive: false }));
    expect(nextAlivePlayer(noneAlive, "alice")).toBeNull();
  });
});

describe("endReasonFor", () => {
  const session = { max_turns_per_player: 5 };

  it("throws if no players are alive - an unreachable invariant violation", () => {
    expect(() => endReasonFor(session, [])).toThrow(GameError);
  });

  it("ends by elimination when exactly one player is left", () => {
    expect(endReasonFor(session, [player({ id: "winner" })])).toBe("elimination");
  });

  it("continues when players are alive and under the turn cap", () => {
    const alive = [player({ id: "a", turns_taken: 2 }), player({ id: "b", turns_taken: 4 })];
    expect(endReasonFor(session, alive)).toBeNull();
  });

  it("ends by turn cap once every remaining player has hit it", () => {
    const alive = [player({ id: "a", turns_taken: 5 }), player({ id: "b", turns_taken: 7 })];
    expect(endReasonFor(session, alive)).toBe("turn_cap");
  });

  it("does not end by turn cap if even one player is still under it", () => {
    const alive = [player({ id: "a", turns_taken: 5 }), player({ id: "b", turns_taken: 4 })];
    expect(endReasonFor(session, alive)).toBeNull();
  });
});
