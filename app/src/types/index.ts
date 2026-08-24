export type Role = 'owner' | 'admin' | 'recorder'
export type PlayerPosition =
  | 'GK' | 'RB' | 'CB' | 'LB' | 'CDM' | 'CM' | 'CAM' | 'LM' | 'RM' | 'LW' | 'RW' | 'ST' | 'CF'
export type PlayerStatus = 'active' | 'inactive' | 'guest' | 'pending'
export type SessionStatus = 'scheduled' | 'live' | 'paused' | 'completed' | 'cancelled'
export type MatchStatus = 'pending' | 'live' | 'completed' | 'abandoned'
export type Side = 'a' | 'b'
export type PeriodStatus = 'open' | 'closed'
export type Band = 'early' | 'on_time' | 'late' | 'very_late'

export type EventType =
  | 'goal' | 'own_goal' | 'assist' | 'yellow_card' | 'red_card'
  | 'clean_sheet' | 'appearance' | 'punctuality' | 'save' | 'motm'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  onboarded_at: string | null
  deleted_at?: string | null
}

export interface Organization {
  id: string
  name: string
  short_name: string | null
  slug: string
  logo_url: string | null
  description: string | null
  location: string | null
  venue: string | null
  format: '5aside' | '7aside' | '11aside' | 'custom'
  players_per_side: number
  playing_days: string[]
  default_kickoff: string
  timezone: string
  is_public: boolean
  role?: Role
  settings?: OrgSettings
  current_period?: Period
  public_page?: PublicPage
}

export interface OrgSettings {
  organization_id: string
  clean_sheet_policy: 'goalkeeper' | 'whole_side' | 'manual'
  track_punctuality: boolean
  track_cards: boolean
  track_clean_sheets: boolean
  guests_on_leaderboard: boolean
  early_before_mins: number
  on_time_after_mins: number
  late_after_mins: number
  early_points: number
  on_time_points: number
  late_points: number
  very_late_points: number
  voting_enabled: boolean
  auto_close_months: boolean
  auto_close_grace_days: number
}

export interface PublicPage {
  slug: string
  is_published: boolean
  show_photos: boolean
  show_cards: boolean
  show_punctuality: boolean
  show_sessions: boolean
  view_count: number
}

export interface SessionSlot {
  id: string
  organization_id: string
  label: string | null
  /** 0 = Sunday … 6 = Saturday, matching Date.getDay() */
  weekday: number
  kickoff: string
  duration_minutes: number
  venue: string | null
  is_active: boolean
  display_label: string
  day_name: string
}

export interface UpcomingSlot {
  slot_id: string
  label: string | null
  weekday: number
  kickoff: string
  venue: string | null
  occurs_at: string
  already_scheduled: boolean
  display_label: string
  day_name: string
}

export interface Player {
  id: string
  organization_id: string
  first_name: string
  last_name: string | null
  display_name: string
  whatsapp_nickname: string | null
  photo_url: string | null
  jersey_number: number | null
  position: PlayerPosition | null
  preferred_foot: 'left' | 'right' | 'both' | null
  status: PlayerStatus
  joined_at: string
  stats?: PlayerStats | null
}

export interface PlayerStats {
  player_id: string
  period_id: string
  appearances: number
  goals: number
  own_goals: number
  assists: number
  clean_sheets: number
  yellow_cards: number
  red_cards: number
  saves: number
  punctuality_score: number
  vote_points: number
  total_points: number
  rank: number | null
  players?: Player
}

export interface Period {
  id: string
  label: string
  year: number
  month: number
  status: PeriodStatus
  starts_on?: string
  ends_on?: string
  closed_at?: string | null
  closed_automatically?: boolean
  auto_close_blocked_at?: string | null
  auto_close_blocked_reason?: string | null
}

export interface Session {
  id: string
  organization_id: string
  period_id: string
  title: string | null
  session_date: string
  kickoff_at: string
  venue: string | null
  status: SessionStatus
  notes: string | null
  slot_id?: string | null
  is_auto_generated?: boolean
  flagged_inactive_at?: string | null
  approved_at?: string | null
  approved_by?: string | null
  actual_kickoff_at?: string | null
  ended_at?: string | null
  scheduled_end_at?: string | null
  last_activity_at?: string | null
  last_viewed_at?: string | null
  awaiting_confirmation?: boolean
  /** Set when the scheduler paused a quiet session. Cleared on resume. */
  paused_at?: string | null
  paused_reason?: string | null
  matches?: Match[]
  attendance?: Attendance[]
}

/** A session counts unless it was flagged inactive and never approved. */
export function sessionCounted(session: Pick<Session, 'flagged_inactive_at' | 'approved_at'>): boolean {
  return !session.flagged_inactive_at || !!session.approved_at
}

export interface Attendance {
  id: string
  session_id: string
  player_id: string
  status: 'present' | 'absent' | 'excused'
  arrived_at: string | null
  punctuality_band: Band | null
  punctuality_points: number
  players?: Player
}

export interface Match {
  id: string
  session_id: string
  sequence: number
  duration_minutes: number
  started_at: string | null
  ended_at: string | null
  status: MatchStatus
  side_a_label: string
  side_b_label: string
  side_a_score: number
  side_b_score: number
  players?: MatchPlayer[]
  events?: MatchEvent[]
  sessions?: { id: string; period_id: string; session_date: string }
}

export interface MatchPlayer {
  id: string
  match_id: string
  player_id: string
  side: Side
  is_goalkeeper: boolean
  players?: Player
}

export interface MatchEvent {
  id: string
  match_id: string
  player_id: string
  related_player_id: string | null
  event_type: EventType
  side: Side | null
  minute: number | null
  metadata: Record<string, unknown>
  created_at: string
  created_by?: string | null
  edited_at?: string | null
  edited_by?: string | null
  players?: {
    display_name: string
    whatsapp_nickname?: string | null
    jersey_number: number | null
    photo_url?: string | null
  }
}

export interface ScoringRule {
  id: string
  event_type: EventType
  points: number
  enabled: boolean
}

export interface ScoringPreset {
  key: string
  name: string
  description: string
  rules: Record<string, number>
}

export interface Award {
  id: string
  value: number | null
  breakdown: Record<string, unknown>
  awarded_at: string
  award_types: { code: string; name: string; icon: string; description?: string }
  players: Player
  periods?: { label: string }
}

export interface DashboardData {
  period: Period
  totals: { goals: number; assists: number; clean_sheets: number; cards: number; players: number; sessions: number }
  leaderboard: PlayerStats[]
  top_scorer: PlayerStats | null
  top_assister: PlayerStats | null
  top_keeper: PlayerStats | null
  recent_sessions: Session[]
  live_session: { id: string; status?: SessionStatus; paused_at?: string | null } | null
}

export interface DeleteAccountPreview {
  organizations: {
    id: string
    name: string
    player_count: number
    session_count: number
    other_member_count: number
  }[]
  warning: string
}

export interface MemberRow {
  id: string
  role: Role
  status: 'invited' | 'active' | 'revoked'
  invited_email: string | null
  profiles: Profile | null
}

/* ---- Public share page ---- */

export interface PublicPlayerRef {
  id: string
  display_name: string
  whatsapp_nickname?: string | null
  jersey_number: number | null
  position: PlayerPosition | null
  photo_url: string | null
}

export interface PublicRow {
  rank: number
  player: PublicPlayerRef
  appearances: number
  goals: number
  assists: number
  clean_sheets: number
  total_points: number
  yellow_cards?: number
  red_cards?: number
  punctuality_score?: number
}

export interface PublicPageData {
  organization: {
    name: string
    short_name: string | null
    slug: string
    logo_url: string | null
    description: string | null
    location: string | null
    venue: string | null
    format: string
  }
  period: Period
  periods: Period[]
  totals: { players: number; sessions: number; goals: number; assists: number }
  leaderboard: PublicRow[]
  awards: { type: { code: string; name: string; icon: string }; value: number; player: PublicPlayerRef }[]
  top_scorer: { player: PublicPlayerRef; value: number } | null
  top_assister: { player: PublicPlayerRef; value: number } | null
  top_keeper: { player: PublicPlayerRef; value: number } | null
  sessions: Session[]
  live_session: { id: string; title: string | null; session_date: string } | null
  settings: { show_photos: boolean; show_cards: boolean; show_punctuality: boolean; show_sessions: boolean }
}

/* -------------------------------------------------------------------------- */
/* Competitions                                                                */
/* -------------------------------------------------------------------------- */

export type CompetitionStatus = 'draft' | 'drafting_teams' | 'scheduled' | 'live' | 'completed' | 'cancelled'

export interface Competition {
  id: string
  organization_id: string
  period_id: string
  name: string
  status: CompetitionStatus
  starts_on: string
  ends_on: string
  day_ends_at: string | null
  day_starts_at: string | null
  evening_starts_at: string | null
  evening_ends_at: string | null
  matches_per_day: number | null
  concurrent_matches: number
  break_between_matches_minutes: number
  split_into_halves: boolean
  halftime_break_minutes: number | null
  format: 'league'
  double_round_robin: boolean
  team_count: number
  squad_size: number
  pitch_size: number
  match_duration_minutes: number | null
  count_toward_stats: boolean
  voided_at?: string | null
  competition_teams?: CompetitionTeam[]
  competition_players?: CompetitionPlayerLink[]
}

export interface CompetitionPlayerLink {
  id: string
  player_id: string
  joined_at: string
  removed_at: string | null
  players?: Player
}

export interface CompetitionTeam {
  id: string
  competition_id: string
  name: string | null
  short_name: string | null
  color: string | null
  captain_player_id: string | null
  sort_order: number
  competition_team_players?: CompetitionTeamPlayerLink[]
}

export interface CompetitionTeamPlayerLink {
  id: string
  player_id: string
  joined_at: string
  removed_at: string | null
  players?: Player
}

export interface CompetitionFixture {
  id: string
  competition_id: string
  competition_round_id: string
  sequence: number
  home_team_id: string
  away_team_id: string
  scheduled_at: string | null
  duration_minutes: number | null
  match_id: string | null
  home_team?: { id: string; name: string | null; short_name: string | null; color: string | null }
  away_team?: { id: string; name: string | null; short_name: string | null; color: string | null }
  matches?: { id: string; status: MatchStatus; side_a_score: number; side_b_score: number; started_at: string | null; ended_at: string | null }
}

export interface StandingsRow {
  team_id: string
  played: number
  won: number
  drawn: number
  lost: number
  goals_for: number
  goals_against: number
  goal_difference: number
  points: number
  team?: { id: string; name: string | null; short_name: string | null; color: string | null }
}

export interface TeamBalance {
  team_id: string
  player_count: number
  average_quality: number
  // null = not enough match history yet to compare teams meaningfully
  strength_rating: number | null
}

export interface StatsBreakdownSource {
  source: 'session' | 'competition'
  appearances: number
  goals: number
  own_goals: number
  assists: number
  clean_sheets: number
  yellow_cards: number
  red_cards: number
  saves: number
}

export interface StatsBreakdown {
  period: Period
  session: StatsBreakdownSource | null
  competition: StatsBreakdownSource | null
}

export interface PublicSessionData {
  organization: { name: string; slug: string; logo_url: string | null }
  session: {
    id: string
    session_date: string
    title: string | null
    status: SessionStatus
    venue: string | null
    actual_kickoff_at: string | null
    kickoff_at: string
  }
  matches: {
    id: string
    sequence: number
    side_a_label: string
    side_b_label: string
    side_a_score: number
    side_b_score: number
    status: string
    started_at: string | null
  }[]
  events: {
    match_id: string
    event_type: EventType
    minute: number | null
    players: { id: string; display_name: string; whatsapp_nickname?: string | null; jersey_number: number | null } | null
  }[]
}

/* -------------------------------------------------------------------------- */
/* The monthly breakdown                                                       */
/* -------------------------------------------------------------------------- */

export interface ReportLine {
  player_id: string
  player: string
  display_name?: string
  photo_url?: string | null
  goals: number
  assists: number
  contributions: number
  clean_sheets: number
  appearances: number
  yellow_cards: number
  red_cards: number
  points: number
  rank: number | null
}

export interface ReportRecord {
  kind: 'month_record'
  metric: string
  metric_label: string
  player_id: string
  player: string
  value: number
  appearances: number
  first_ever: boolean
  previous: { player: string; value: number; appearances: number; month: string } | null
}

export interface ReportMilestone {
  kind: 'milestone'
  metric: string
  noun: string
  threshold: number
  player_id: string
  player: string
  total: number
  first_ever: boolean
}

export interface ReportDouble {
  kind: 'double'
  player_id: string
  player: string
  goals: number
  assists: number
  first_ever: boolean
}

export interface CareerLine {
  player_id: string
  player: string
  goals: number
  assists: number
  contributions: number
  clean_sheets: number
  appearances: number
  points: number
}

export interface RankedEntry {
  player_id: string
  player: string
  value: number
  appearances: number
  per_game?: number
  month?: string
}

export interface MonthReport {
  provisional: boolean
  generated_at: string
  period: {
    id: string
    label: string
    year: number
    month: number
    status: PeriodStatus
    starts_on: string
    ends_on: string
  }
  summary: {
    players: number
    goals: number
    assists: number
    clean_sheets: number
    appearances: number
    matches: number
  }
  squad_size: number
  attendance: {
    session_count: number
    average: number
    best: number
    lowest: number
    sessions: { session_id: string; date: string; title: string | null; attendees: number }[]
  }
  perfect_attendance: { player_id: string; player: string }[]
  totals: ReportLine[]
  awards: {
    code: string
    name: string
    icon: string | null
    player_id: string
    player: string
    photo_url: string | null
    value: number | null
  }[]
  records: ReportRecord[]
  doubles: ReportDouble[]
  milestones: ReportMilestone[]
  nominations: { player_id: string; player: string; nominations: number }[]
  potm_history: { month: string; year: number; month_number: number; player_id: string; player: string; value: number }[]
  month_records: Record<string, RankedEntry[]>
  alltime: { table: CareerLine[]; top: Record<string, RankedEntry[]> }
  headlines: string[]
}
