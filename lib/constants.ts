// Pause between the score reveal and the next player's timer starting, so
// everyone has time to read the story and the judge's verdict.
export const COOLDOWN_SECONDS = 30;

// Bounds on the host-configurable per-turn timer.
export const MIN_TURN_SECONDS = 10;
export const MAX_TURN_SECONDS = 300; // 5 minutes

// Chip options offered on the home page: 1-5 minutes.
export const TURN_SECONDS_OPTIONS = [60, 120, 180, 240, 300];

// Elimination mode has no host-facing turn cap - this is just a safety net
// so a game between strong writers who never trip the avg<50 line can't run
// forever. Generous on purpose; if it's ever reached, ranking falls back to
// each player's own total score.
export const ELIMINATION_SAFETY_TURN_CAP = 15;

// Marathon mode has no elimination at all - the turn cap IS the game length,
// so it's the host's headline choice (rounds per player).
export const MARATHON_TURN_OPTIONS = [4, 6, 8, 10];

// Loose ceiling on a turn's length - not "one sentence" anymore (line breaks
// are allowed), just a guard against unbounded pastes.
export const MAX_SENTENCE_LENGTH = 1500;

// Chip options for the opening's genre/theme. Empty string = "surprise me"
// (any genre, the original behavior); a host can also type a custom one.
export const GENRE_OPTIONS = ["Fantasy", "Sci-Fi", "Mystery", "Horror", "Romance", "Comedy", "Adventure"] as const;
export const MAX_GENRE_LENGTH = 60;
