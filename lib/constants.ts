// Pause between the score reveal and the next player's timer starting, so
// everyone has time to read the story and the judge's verdict.
export const COOLDOWN_SECONDS = 30;

// Bounds on the host-configurable per-turn timer.
export const MIN_TURN_SECONDS = 10;
export const MAX_TURN_SECONDS = 300; // 5 minutes

// Chip options offered on the home page: 1-5 minutes.
export const TURN_SECONDS_OPTIONS = [60, 120, 180, 240, 300];
