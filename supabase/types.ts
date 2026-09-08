export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      fixtures: {
        Row: {
          away_score: number | null
          away_team_id: string
          created_at: string | null
          home_score: number | null
          home_team_id: string
          id: string
          match_date: string
          status: string | null
          updated_at: string | null
          venue: string | null
          stage: string | null
          home_xg: number | null
          away_xg: number | null
          home_goalkeeper_id: string | null
          away_goalkeeper_id: string | null
          home_clean_sheet: boolean | null
          away_clean_sheet: boolean | null
        }
        Insert: {
          away_score?: number | null
          away_team_id: string
          created_at?: string | null
          home_score?: number | null
          home_team_id: string
          id?: string
          match_date: string
          status?: string | null
          updated_at?: string | null
          venue?: string | null
          stage?: string | null
          home_xg?: number | null
          away_xg?: number | null
          home_goalkeeper_id?: string | null
          away_goalkeeper_id?: string | null
          home_clean_sheet?: boolean | null
          away_clean_sheet?: boolean | null
        }
        Update: {
          away_score?: number | null
          away_team_id?: string
          created_at?: string | null
          home_score?: number | null
          home_team_id?: string
          id?: string
          match_date?: string
          status?: string | null
          updated_at?: string | null
          venue?: string | null
          stage?: string | null
          home_xg?: number | null
          away_xg?: number | null
          home_goalkeeper_id?: string | null
          away_goalkeeper_id?: string | null
          home_clean_sheet?: boolean | null
          away_clean_sheet?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "fixtures_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          }
        ]
      }
      match_events: {
        Row: {
          created_at: string | null
          details: string | null
          event_type: string
          fixture_id: string
          id: string
          minute: number
          player_id: string | null
          player_name: string | null
          team_id: string | null
          assist_player_id: string | null
          xg_value: number | null
        }
        Insert: {
          created_at?: string | null
          details?: string | null
          event_type: string
          fixture_id: string
          id?: string
          minute: number
          player_id?: string | null
          player_name?: string | null
          team_id?: string | null
          assist_player_id?: string | null
          xg_value?: number | null
        }
        Update: {
          created_at?: string | null
          details?: string | null
          event_type?: string
          fixture_id?: string
          id?: string
          minute?: number
          player_id?: string | null
          player_name?: string | null
          team_id?: string | null
          assist_player_id?: string | null
          xg_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "match_events_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          }
        ]
      }
      teams: {
        Row: {
          attire_color: string | null
          coach: string | null
          created_at: string | null
          id: string
          logo_url: string | null
          name: string
          roster: string | null
          short_name: string | null
          group_name: string | null
        }
        Insert: {
          attire_color?: string | null
          coach?: string | null
          created_at?: string | null
          id?: string
          logo_url?: string | null
          name: string
          roster?: string | null
          short_name?: string | null
          group_name?: string | null
        }
        Update: {
          attire_color?: string | null
          coach?: string | null
          created_at?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          roster?: string | null
          short_name?: string | null
          group_name?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      players: {
        Row: {
          id: string
          team_id: string
          name: string
          position: string | null
          shirt_number: number | null
          created_at: string | null
        }
        Insert: {
          id?: string
          team_id: string
          name: string
          position?: string | null
          shirt_number?: number | null
          created_at?: string | null
        }
        Update: {
          id?: string
          team_id?: string
          name?: string
          position?: string | null
          shirt_number?: number | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "players_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          }
        ]
      }
      tournament_settings: {
        Row: {
          id: string
          rules_text: string | null
          rules_pdf_url: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          rules_text?: string | null
          rules_pdf_url?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          rules_text?: string | null
          rules_pdf_url?: string | null
          updated_at?: string | null
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
