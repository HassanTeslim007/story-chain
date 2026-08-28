export type SessionStatus = "lobby" | "active" | "finished";
export type SessionPhase = "turn" | "cooldown";
export type SessionMode = "elimination" | "marathon";
export type EndReason = "elimination" | "turn_cap";

export type Session = {
  id: string;
  code: string;
  status: SessionStatus;
  phase: SessionPhase;
  mode: SessionMode;
  max_turns_per_player: number;
  end_reason: EndReason | null;
  turn_seconds: number;
  current_turn_player_id: string | null;
  turn_number: number;
  turn_deadline: string | null;
  total_score: number;
  score_count: number;
  winner_player_id: string | null;
  created_at: string;
};

export type Player = {
  id: string;
  session_id: string;
  name: string;
  turn_order: number;
  is_alive: boolean;
  turns_taken: number;
  joined_at: string;
};

export type Sentence = {
  id: string;
  session_id: string;
  player_id: string | null;
  turn_number: number;
  content: string;
  score: number | null;
  removed: boolean;
  reasoning: string | null;
  created_at: string;
};

export type GameState = {
  session: Session;
  players: Player[];
  sentences: Sentence[];
};
