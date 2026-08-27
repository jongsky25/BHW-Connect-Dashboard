export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      admin_users: {
        Row: {
          role: Database["public"]["Enums"]["admin_role_enum"];
          user_id: string;
        };
        Insert: {
          role: Database["public"]["Enums"]["admin_role_enum"];
          user_id: string;
        };
        Update: {
          role?: Database["public"]["Enums"]["admin_role_enum"];
          user_id?: string;
        };
        Relationships: [];
      };
      agg_bhw_counts: {
        Row: {
          adjusted_pct: number | null;
          any_honorarium_pct: number | null;
          avg_active_years: number | null;
          ci_high: number | null;
          ci_low: number | null;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id: number;
          n_accredited: number | null;
          n_total: number | null;
          pct_accredited: number | null;
        };
        Insert: {
          adjusted_pct?: number | null;
          any_honorarium_pct?: number | null;
          avg_active_years?: number | null;
          ci_high?: number | null;
          ci_low?: number | null;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          n_accredited?: number | null;
          n_total?: number | null;
          pct_accredited?: number | null;
        };
        Update: {
          adjusted_pct?: number | null;
          any_honorarium_pct?: number | null;
          avg_active_years?: number | null;
          ci_high?: number | null;
          ci_low?: number | null;
          dataset_id?: number;
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          n_accredited?: number | null;
          n_total?: number | null;
          pct_accredited?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "agg_bhw_counts_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "agg_bhw_counts_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      agg_by_income_class: {
        Row: {
          any_honorarium_pct: number | null;
          dataset_id: number;
          id: number;
          income_class: number;
          median_honorarium_amount: number | null;
          n_bhw: number;
          n_citymun: number | null;
          pct_accredited: number | null;
        };
        Insert: {
          any_honorarium_pct?: number | null;
          dataset_id: number;
          id?: never;
          income_class: number;
          median_honorarium_amount?: number | null;
          n_bhw: number;
          n_citymun?: number | null;
          pct_accredited?: number | null;
        };
        Update: {
          any_honorarium_pct?: number | null;
          dataset_id?: number;
          id?: never;
          income_class?: number;
          median_honorarium_amount?: number | null;
          n_bhw?: number;
          n_citymun?: number | null;
          pct_accredited?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "agg_by_income_class_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
        ];
      };
      agg_cohorts: {
        Row: {
          cohort_year: number;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id: number;
          kind: string;
          n: number;
        };
        Insert: {
          cohort_year: number;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          kind: string;
          n: number;
        };
        Update: {
          cohort_year?: number;
          dataset_id?: number;
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          kind?: string;
          n?: number;
        };
        Relationships: [
          {
            foreignKeyName: "agg_cohorts_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "agg_cohorts_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      agg_honorarium_cumulative: {
        Row: {
          band_label: string;
          band_order: number;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id: number;
          is_suppressed: boolean;
          median_cumulative_monthly: number | null;
          n: number | null;
          n_total: number;
          pct: number | null;
          pct_below_sufficiency: number | null;
        };
        Insert: {
          band_label: string;
          band_order: number;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          is_suppressed?: boolean;
          median_cumulative_monthly?: number | null;
          n?: number | null;
          n_total: number;
          pct?: number | null;
          pct_below_sufficiency?: number | null;
        };
        Update: {
          band_label?: string;
          band_order?: number;
          dataset_id?: number;
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          is_suppressed?: boolean;
          median_cumulative_monthly?: number | null;
          n?: number | null;
          n_total?: number;
          pct?: number | null;
          pct_below_sufficiency?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "agg_honorarium_cumulative_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "agg_honorarium_cumulative_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      agg_honorarium_inequality: {
        Row: {
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          gini: number | null;
          id: number;
          is_suppressed: boolean;
          n_receiving: number;
          p10_amount: number | null;
          p90_amount: number | null;
          p90_p10_ratio: number | null;
        };
        Insert: {
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          gini?: number | null;
          id?: never;
          is_suppressed?: boolean;
          n_receiving: number;
          p10_amount?: number | null;
          p90_amount?: number | null;
          p90_p10_ratio?: number | null;
        };
        Update: {
          dataset_id?: number;
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          gini?: number | null;
          id?: never;
          is_suppressed?: boolean;
          n_receiving?: number;
          p10_amount?: number | null;
          p90_amount?: number | null;
          p90_p10_ratio?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "agg_honorarium_inequality_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "agg_honorarium_inequality_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      agg_workload: {
        Row: {
          busiest_decile_share: number | null;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id: number;
          is_suppressed: boolean;
          mean: number | null;
          median: number | null;
          n_bhw: number;
          p10: number | null;
          p25: number | null;
          p75: number | null;
          p90: number | null;
        };
        Insert: {
          busiest_decile_share?: number | null;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          is_suppressed?: boolean;
          mean?: number | null;
          median?: number | null;
          n_bhw: number;
          p10?: number | null;
          p25?: number | null;
          p75?: number | null;
          p90?: number | null;
        };
        Update: {
          busiest_decile_share?: number | null;
          dataset_id?: number;
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          is_suppressed?: boolean;
          mean?: number | null;
          median?: number | null;
          n_bhw?: number;
          p10?: number | null;
          p25?: number | null;
          p75?: number | null;
          p90?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "agg_workload_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "agg_workload_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      agg_bhw_profiling_status: {
        Row: {
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id: number;
          n_accredited: number;
          n_approved: number;
          n_back_to_encoder: number;
          n_drafted: number;
          n_for_validation: number;
          n_registered: number;
          n_total_bhw: number;
          n_unregistered: number;
          n_validated: number;
        };
        Insert: {
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          n_accredited?: number;
          n_approved?: number;
          n_back_to_encoder?: number;
          n_drafted?: number;
          n_for_validation?: number;
          n_registered?: number;
          n_total_bhw?: number;
          n_unregistered?: number;
          n_validated?: number;
        };
        Update: {
          dataset_id?: number;
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          n_accredited?: number;
          n_approved?: number;
          n_back_to_encoder?: number;
          n_drafted?: number;
          n_for_validation?: number;
          n_registered?: number;
          n_total_bhw?: number;
          n_unregistered?: number;
          n_validated?: number;
        };
        Relationships: [
          {
            foreignKeyName: "agg_bhw_profiling_status_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "agg_bhw_profiling_status_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      agg_bhw_stepzero_counts: {
        Row: {
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          households: number | null;
          id: number;
          n_non_registered: number | null;
          n_registered: number | null;
          n_registered_accredited: number | null;
          n_total_bhw: number | null;
          pct_registered_accredited: number | null;
          population: number | null;
        };
        Insert: {
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          households?: number | null;
          id?: never;
          n_non_registered?: number | null;
          n_registered?: number | null;
          n_registered_accredited?: number | null;
          n_total_bhw?: number | null;
          pct_registered_accredited?: number | null;
          population?: number | null;
        };
        Update: {
          dataset_id?: number;
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          households?: number | null;
          id?: never;
          n_non_registered?: number | null;
          n_registered?: number | null;
          n_registered_accredited?: number | null;
          n_total_bhw?: number | null;
          pct_registered_accredited?: number | null;
          population?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "agg_bhw_stepzero_counts_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "agg_bhw_stepzero_counts_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      agg_certification: {
        Row: {
          cert_type: string;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id: number;
          n: number | null;
          pct: number | null;
        };
        Insert: {
          cert_type: string;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          n?: number | null;
          pct?: number | null;
        };
        Update: {
          cert_type?: string;
          dataset_id?: number;
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          n?: number | null;
          pct?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "agg_certification_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "agg_certification_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      agg_data_completeness: {
        Row: {
          dataset_id: number;
          field_name: string;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id: number;
          n_missing: number | null;
          pct_missing: number | null;
        };
        Insert: {
          dataset_id: number;
          field_name: string;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          n_missing?: number | null;
          pct_missing?: number | null;
        };
        Update: {
          dataset_id?: number;
          field_name?: string;
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          n_missing?: number | null;
          pct_missing?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "agg_data_completeness_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
        ];
      };
      agg_demographics: {
        Row: {
          category: string;
          dataset_id: number;
          dimension: Database["public"]["Enums"]["demographic_dimension_enum"];
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id: number;
          is_suppressed: boolean;
          n: number | null;
          pct: number | null;
          rollup_geo_code: string | null;
          rollup_geo_level: Database["public"]["Enums"]["geo_level_enum"] | null;
        };
        Insert: {
          category: string;
          dataset_id: number;
          dimension: Database["public"]["Enums"]["demographic_dimension_enum"];
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          is_suppressed?: boolean;
          n?: number | null;
          pct?: number | null;
          rollup_geo_code?: string | null;
          rollup_geo_level?: Database["public"]["Enums"]["geo_level_enum"] | null;
        };
        Update: {
          category?: string;
          dataset_id?: number;
          dimension?: Database["public"]["Enums"]["demographic_dimension_enum"];
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          is_suppressed?: boolean;
          n?: number | null;
          pct?: number | null;
          rollup_geo_code?: string | null;
          rollup_geo_level?: Database["public"]["Enums"]["geo_level_enum"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "agg_demographics_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "agg_demographics_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
          {
            foreignKeyName: "agg_demographics_rollup_geo_code_fkey";
            columns: ["rollup_geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      agg_geo_summary: {
        Row: {
          any_honorarium_pct: number | null;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          geo_name: string;
          n_total: number | null;
          parent_chain: Json | null;
          pct_accredited: number | null;
          search_text: unknown;
          top_training_gap: string | null;
        };
        Insert: {
          any_honorarium_pct?: number | null;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          geo_name: string;
          n_total?: number | null;
          parent_chain?: Json | null;
          pct_accredited?: number | null;
          search_text?: unknown;
          top_training_gap?: string | null;
        };
        Update: {
          any_honorarium_pct?: number | null;
          dataset_id?: number;
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          geo_name?: string;
          n_total?: number | null;
          parent_chain?: Json | null;
          pct_accredited?: number | null;
          search_text?: unknown;
          top_training_gap?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "agg_geo_summary_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "agg_geo_summary_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      agg_honorarium: {
        Row: {
          avg_monthly_amount: number | null;
          ci_high: number | null;
          ci_low: number | null;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id: number;
          is_suppressed: boolean;
          max_amount: number | null;
          median_amount: number | null;
          min_amount: number | null;
          modal_frequency: Database["public"]["Enums"]["honorarium_frequency_enum"] | null;
          n_receiving: number | null;
          p25_amount: number | null;
          p75_amount: number | null;
          payer_level: Database["public"]["Enums"]["payer_level_enum"];
          pct_receiving: number | null;
        };
        Insert: {
          avg_monthly_amount?: number | null;
          ci_high?: number | null;
          ci_low?: number | null;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          is_suppressed?: boolean;
          max_amount?: number | null;
          median_amount?: number | null;
          min_amount?: number | null;
          modal_frequency?: Database["public"]["Enums"]["honorarium_frequency_enum"] | null;
          n_receiving?: number | null;
          p25_amount?: number | null;
          p75_amount?: number | null;
          payer_level: Database["public"]["Enums"]["payer_level_enum"];
          pct_receiving?: number | null;
        };
        Update: {
          avg_monthly_amount?: number | null;
          ci_high?: number | null;
          ci_low?: number | null;
          dataset_id?: number;
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          is_suppressed?: boolean;
          max_amount?: number | null;
          median_amount?: number | null;
          min_amount?: number | null;
          modal_frequency?: Database["public"]["Enums"]["honorarium_frequency_enum"] | null;
          n_receiving?: number | null;
          p25_amount?: number | null;
          p75_amount?: number | null;
          payer_level?: Database["public"]["Enums"]["payer_level_enum"];
          pct_receiving?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "agg_honorarium_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "agg_honorarium_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      agg_peer_ranks: {
        Row: {
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id: number;
          indicator: string;
          is_outlier: boolean;
          mad: number | null;
          median: number | null;
          n_siblings: number | null;
          n_total: number | null;
          percentile: number | null;
          rank_position: number | null;
          value: number | null;
        };
        Insert: {
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          indicator: string;
          is_outlier?: boolean;
          mad?: number | null;
          median?: number | null;
          n_siblings?: number | null;
          n_total?: number | null;
          percentile?: number | null;
          rank_position?: number | null;
          value?: number | null;
        };
        Update: {
          dataset_id?: number;
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          indicator?: string;
          is_outlier?: boolean;
          mad?: number | null;
          median?: number | null;
          n_siblings?: number | null;
          n_total?: number | null;
          percentile?: number | null;
          rank_position?: number | null;
          value?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "agg_peer_ranks_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "agg_peer_ranks_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      agg_population: {
        Row: {
          census_year: number;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id: number;
          population: number;
        };
        Insert: {
          census_year: number;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          population: number;
        };
        Update: {
          census_year?: number;
          dataset_id?: number;
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          population?: number;
        };
        Relationships: [
          {
            foreignKeyName: "agg_population_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "agg_population_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      agg_poverty: {
        Row: {
          ci_high: number | null;
          ci_low: number | null;
          cv: number | null;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id: number;
          poverty_incidence: number;
          sae_year: number;
          se: number | null;
        };
        Insert: {
          ci_high?: number | null;
          ci_low?: number | null;
          cv?: number | null;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          poverty_incidence: number;
          sae_year: number;
          se?: number | null;
        };
        Update: {
          ci_high?: number | null;
          ci_low?: number | null;
          cv?: number | null;
          dataset_id?: number;
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          poverty_incidence?: number;
          sae_year?: number;
          se?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "agg_poverty_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "agg_poverty_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      agg_training: {
        Row: {
          ci_high: number | null;
          ci_low: number | null;
          coverage_pct: number | null;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id: number;
          median_training_year: number | null;
          n_total: number | null;
          n_trained: number | null;
          topic_label: string | null;
          topic_slug: string;
        };
        Insert: {
          ci_high?: number | null;
          ci_low?: number | null;
          coverage_pct?: number | null;
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          median_training_year?: number | null;
          n_total?: number | null;
          n_trained?: number | null;
          topic_label?: string | null;
          topic_slug: string;
        };
        Update: {
          ci_high?: number | null;
          ci_low?: number | null;
          coverage_pct?: number | null;
          dataset_id?: number;
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          median_training_year?: number | null;
          n_total?: number | null;
          n_trained?: number | null;
          topic_label?: string | null;
          topic_slug?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agg_training_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "agg_training_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      agg_uuc_phc_counts: {
        Row: {
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id: number;
          n_barangays: number;
          n_listed: number;
        };
        Insert: {
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          n_barangays?: number;
          n_listed?: number;
        };
        Update: {
          dataset_id?: number;
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          n_barangays?: number;
          n_listed?: number;
        };
        Relationships: [
          {
            foreignKeyName: "agg_uuc_phc_counts_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "agg_uuc_phc_counts_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      agg_uuc_phc_criteria: {
        Row: {
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id: number;
          n_health_evaluable: number;
          n_listed: number;
          n_route_conflict: number;
          n_route_four_ps: number;
          n_route_health: number;
          n_route_ip: number;
        };
        Insert: {
          dataset_id: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          n_health_evaluable?: number;
          n_listed?: number;
          n_route_conflict?: number;
          n_route_four_ps?: number;
          n_route_health?: number;
          n_route_ip?: number;
        };
        Update: {
          dataset_id?: number;
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          id?: never;
          n_health_evaluable?: number;
          n_listed?: number;
          n_route_conflict?: number;
          n_route_four_ps?: number;
          n_route_health?: number;
          n_route_ip?: number;
        };
        Relationships: [
          {
            foreignKeyName: "agg_uuc_phc_criteria_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "agg_uuc_phc_criteria_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      ai_ask_cache: {
        Row: {
          answer_md: string;
          cache_key: string;
          data_version: string;
          generated_at: string;
          geo_code: string | null;
          hit_count: number;
          last_hit_at: string | null;
          provider: string | null;
          question_display: string;
          question_norm: string;
          status: string;
        };
        Insert: {
          answer_md: string;
          cache_key: string;
          data_version: string;
          generated_at?: string;
          geo_code?: string | null;
          hit_count?: number;
          last_hit_at?: string | null;
          provider?: string | null;
          question_display: string;
          question_norm: string;
          status?: string;
        };
        Update: {
          answer_md?: string;
          cache_key?: string;
          data_version?: string;
          generated_at?: string;
          geo_code?: string | null;
          hit_count?: number;
          last_hit_at?: string | null;
          provider?: string | null;
          question_display?: string;
          question_norm?: string;
          status?: string;
        };
        Relationships: [];
      };
      ai_ask_log: {
        Row: {
          answer_md: string | null;
          created_at: string;
          data_version: string | null;
          geo_code: string | null;
          geo_level: string | null;
          id: number;
          latency_ms: number | null;
          outcome: string;
          provider: string | null;
          question_norm: string;
          question_raw: string;
          served_from: string;
          session_id: string;
          tool_trace: Json | null;
          turn_index: number;
        };
        Insert: {
          answer_md?: string | null;
          created_at?: string;
          data_version?: string | null;
          geo_code?: string | null;
          geo_level?: string | null;
          id?: never;
          latency_ms?: number | null;
          outcome: string;
          provider?: string | null;
          question_norm: string;
          question_raw: string;
          served_from?: string;
          session_id: string;
          tool_trace?: Json | null;
          turn_index: number;
        };
        Update: {
          answer_md?: string | null;
          created_at?: string;
          data_version?: string | null;
          geo_code?: string | null;
          geo_level?: string | null;
          id?: never;
          latency_ms?: number | null;
          outcome?: string;
          provider?: string | null;
          question_norm?: string;
          question_raw?: string;
          served_from?: string;
          session_id?: string;
          tool_trace?: Json | null;
          turn_index?: number;
        };
        Relationships: [];
      };
      ai_narrative_cache: {
        Row: {
          cache_key: string;
          content_md: string | null;
          data_version: string | null;
          generated_at: string;
          model: string | null;
          provider: string | null;
        };
        Insert: {
          cache_key: string;
          content_md?: string | null;
          data_version?: string | null;
          generated_at?: string;
          model?: string | null;
          provider?: string | null;
        };
        Update: {
          cache_key?: string;
          content_md?: string | null;
          data_version?: string | null;
          generated_at?: string;
          model?: string | null;
          provider?: string | null;
        };
        Relationships: [];
      };
      ai_regression_case: {
        Row: {
          answer_given: string;
          case_id: number;
          citations: Json;
          conversation: Json;
          created_at: string;
          note: string | null;
          provider: string | null;
          question: string;
          reported_by: string | null;
          source: string;
          status: string;
          tool_calls: Json;
          updated_at: string;
        };
        Insert: {
          answer_given: string;
          case_id?: never;
          citations?: Json;
          conversation: Json;
          created_at?: string;
          note?: string | null;
          provider?: string | null;
          question: string;
          reported_by?: string | null;
          source?: string;
          status?: string;
          tool_calls?: Json;
          updated_at?: string;
        };
        Update: {
          answer_given?: string;
          case_id?: never;
          citations?: Json;
          conversation?: Json;
          created_at?: string;
          note?: string | null;
          provider?: string | null;
          question?: string;
          reported_by?: string | null;
          source?: string;
          status?: string;
          tool_calls?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      ai_provider_quota: {
        Row: {
          id: number;
          is_paused: boolean;
          limit_value: number;
          paused_until: string | null;
          provider: string;
          request_count: number;
          window_start: string;
          window_type: Database["public"]["Enums"]["quota_window_enum"];
        };
        Insert: {
          id?: never;
          is_paused?: boolean;
          limit_value: number;
          paused_until?: string | null;
          provider: string;
          request_count?: number;
          window_start: string;
          window_type: Database["public"]["Enums"]["quota_window_enum"];
        };
        Update: {
          id?: never;
          is_paused?: boolean;
          limit_value?: number;
          paused_until?: string | null;
          provider?: string;
          request_count?: number;
          window_start?: string;
          window_type?: Database["public"]["Enums"]["quota_window_enum"];
        };
        Relationships: [];
      };
      changelog_entries: {
        Row: {
          body_md: string;
          id: number;
          published_at: string;
          title: string;
        };
        Insert: {
          body_md: string;
          id?: never;
          published_at?: string;
          title: string;
        };
        Update: {
          body_md?: string;
          id?: never;
          published_at?: string;
          title?: string;
        };
        Relationships: [];
      };
      dataset_column: {
        Row: {
          allowed_values: string[] | null;
          column_id: number;
          column_name: string;
          data_type: string;
          distinct_count: number | null;
          is_join_key: boolean;
          is_queryable: boolean;
          joins_to: string | null;
          max_value: string | null;
          meaning: string;
          min_value: string | null;
          null_rate: number | null;
          ordinal: number;
          profiled_at: string | null;
          registry_id: number;
          role: string;
          sample_values: string[] | null;
          status: string;
          unit: string | null;
        };
        Insert: {
          allowed_values?: string[] | null;
          column_id?: never;
          column_name: string;
          data_type: string;
          distinct_count?: number | null;
          is_join_key?: boolean;
          is_queryable?: boolean;
          joins_to?: string | null;
          max_value?: string | null;
          meaning: string;
          min_value?: string | null;
          null_rate?: number | null;
          ordinal: number;
          profiled_at?: string | null;
          registry_id: number;
          role: string;
          sample_values?: string[] | null;
          status?: string;
          unit?: string | null;
        };
        Update: {
          allowed_values?: string[] | null;
          column_id?: never;
          column_name?: string;
          data_type?: string;
          distinct_count?: number | null;
          is_join_key?: boolean;
          is_queryable?: boolean;
          joins_to?: string | null;
          max_value?: string | null;
          meaning?: string;
          min_value?: string | null;
          null_rate?: number | null;
          ordinal?: number;
          profiled_at?: string | null;
          registry_id?: number;
          role?: string;
          sample_values?: string[] | null;
          status?: string;
          unit?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "dataset_column_registry_id_fkey";
            columns: ["registry_id"];
            isOneToOne: false;
            referencedRelation: "dataset_registry";
            referencedColumns: ["registry_id"];
          },
        ];
      };
      dataset_registry: {
        Row: {
          created_at: string;
          dataset_slug: string | null;
          doc_path: string | null;
          exposure: string;
          grain: string;
          notes_md: string | null;
          registry_id: number;
          row_estimate: number | null;
          source_kind: string;
          status: string;
          summary: string;
          table_name: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          dataset_slug?: string | null;
          doc_path?: string | null;
          exposure?: string;
          grain: string;
          notes_md?: string | null;
          registry_id?: never;
          row_estimate?: number | null;
          source_kind?: string;
          status?: string;
          summary: string;
          table_name: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          dataset_slug?: string | null;
          doc_path?: string | null;
          exposure?: string;
          grain?: string;
          notes_md?: string | null;
          registry_id?: never;
          row_estimate?: number | null;
          source_kind?: string;
          status?: string;
          summary?: string;
          table_name?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      dim_dataset: {
        Row: {
          as_of_date: string | null;
          dataset_id: number;
          geo_join_level: Database["public"]["Enums"]["geo_level_enum"] | null;
          last_updated_at: string;
          license: string | null;
          methodology_md: string | null;
          name: string;
          slug: string;
          source_name: string | null;
          source_url: string | null;
          status: string | null;
          version: string | null;
        };
        Insert: {
          as_of_date?: string | null;
          dataset_id?: never;
          geo_join_level?: Database["public"]["Enums"]["geo_level_enum"] | null;
          last_updated_at?: string;
          license?: string | null;
          methodology_md?: string | null;
          name: string;
          slug: string;
          source_name?: string | null;
          source_url?: string | null;
          status?: string | null;
          version?: string | null;
        };
        Update: {
          as_of_date?: string | null;
          dataset_id?: never;
          geo_join_level?: Database["public"]["Enums"]["geo_level_enum"] | null;
          last_updated_at?: string;
          license?: string | null;
          methodology_md?: string | null;
          name?: string;
          slug?: string;
          source_name?: string | null;
          source_url?: string | null;
          status?: string | null;
          version?: string | null;
        };
        Relationships: [];
      };
      dim_geo: {
        Row: {
          citymun_code: string | null;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          geo_name: string;
          income_class: number | null;
          income_class_prior: number | null;
          parent_code: string | null;
          province_code: string | null;
          psgc_vintage: string | null;
          region_code: string | null;
        };
        Insert: {
          citymun_code?: string | null;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          geo_name: string;
          income_class?: number | null;
          income_class_prior?: number | null;
          parent_code?: string | null;
          province_code?: string | null;
          psgc_vintage?: string | null;
          region_code?: string | null;
        };
        Update: {
          citymun_code?: string | null;
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          geo_name?: string;
          income_class?: number | null;
          income_class_prior?: number | null;
          parent_code?: string | null;
          province_code?: string | null;
          psgc_vintage?: string | null;
          region_code?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "dim_geo_parent_code_fkey";
            columns: ["parent_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      dim_lgu_income_reclass: {
        Row: {
          converted: boolean;
          dataset_id: number | null;
          dof_kind: string;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          match_method: string;
          match_score: number | null;
          new_class: number | null;
          old_class_dof: number | null;
          reclass_id: number;
        };
        Insert: {
          converted?: boolean;
          dataset_id?: number | null;
          dof_kind: string;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          match_method: string;
          match_score?: number | null;
          new_class?: number | null;
          old_class_dof?: number | null;
          reclass_id?: never;
        };
        Update: {
          converted?: boolean;
          dataset_id?: number | null;
          dof_kind?: string;
          geo_code?: string;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          match_method?: string;
          match_score?: number | null;
          new_class?: number | null;
          old_class_dof?: number | null;
          reclass_id?: never;
        };
        Relationships: [
          {
            foreignKeyName: "dim_lgu_income_reclass_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "dim_lgu_income_reclass_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      dim_psgc_crosswalk: {
        Row: {
          change_kind: string;
          crosswalk_id: number;
          dataset_id: number | null;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          new_code: string | null;
          new_name: string | null;
          new_vintage: string;
          note: string | null;
          old_code: string;
          old_name: string | null;
          old_vintage: string;
        };
        Insert: {
          change_kind: string;
          crosswalk_id?: never;
          dataset_id?: number | null;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          new_code?: string | null;
          new_name?: string | null;
          new_vintage: string;
          note?: string | null;
          old_code: string;
          old_name?: string | null;
          old_vintage: string;
        };
        Update: {
          change_kind?: string;
          crosswalk_id?: never;
          dataset_id?: number | null;
          geo_level?: Database["public"]["Enums"]["geo_level_enum"];
          new_code?: string | null;
          new_name?: string | null;
          new_vintage?: string;
          note?: string | null;
          old_code?: string;
          old_name?: string | null;
          old_vintage?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dim_psgc_crosswalk_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "dim_psgc_crosswalk_new_code_fkey";
            columns: ["new_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      doc_chunk: {
        Row: {
          char_end: number;
          char_start: number;
          chunk_id: number;
          chunk_index: number;
          content: string;
          content_sha256: string;
          created_at: string;
          doc_id: number;
          heading: string | null;
          page_from: number;
          page_to: number;
          updated_at: string;
        };
        Insert: {
          char_end: number;
          char_start: number;
          chunk_id?: never;
          chunk_index: number;
          content: string;
          content_sha256: string;
          created_at?: string;
          doc_id: number;
          heading?: string | null;
          page_from: number;
          page_to: number;
          updated_at?: string;
        };
        Update: {
          char_end?: number;
          char_start?: number;
          chunk_id?: never;
          chunk_index?: number;
          content?: string;
          content_sha256?: string;
          created_at?: string;
          doc_id?: number;
          heading?: string | null;
          page_from?: number;
          page_to?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "doc_chunk_doc_id_fkey";
            columns: ["doc_id"];
            isOneToOne: false;
            referencedRelation: "doc_source";
            referencedColumns: ["doc_id"];
          },
        ];
      };
      doc_chunk_embedding: {
        Row: {
          chunk_id: number;
          dim: number;
          // pgvector renders as its text form ("[0.1,0.2,...]") over PostgREST.
          embedding: string;
          embedded_at: string;
          model: string;
        };
        Insert: {
          chunk_id: number;
          dim: number;
          embedding: string;
          embedded_at?: string;
          model: string;
        };
        Update: {
          chunk_id?: number;
          dim?: number;
          embedding?: string;
          embedded_at?: string;
          model?: string;
        };
        Relationships: [
          {
            foreignKeyName: "doc_chunk_embedding_chunk_id_fkey";
            columns: ["chunk_id"];
            isOneToOne: false;
            referencedRelation: "doc_chunk";
            referencedColumns: ["chunk_id"];
          },
          {
            foreignKeyName: "doc_chunk_embedding_model_dim_fkey";
            columns: ["model", "dim"];
            isOneToOne: false;
            referencedRelation: "doc_embedding_model";
            referencedColumns: ["model", "dim"];
          },
        ];
      };
      doc_embedding_model: {
        Row: {
          created_at: string;
          dim: number;
          distance: string;
          model: string;
          notes_md: string | null;
          provider: string;
        };
        Insert: {
          created_at?: string;
          dim: number;
          distance?: string;
          model: string;
          notes_md?: string | null;
          provider: string;
        };
        Update: {
          created_at?: string;
          dim?: number;
          distance?: string;
          model?: string;
          notes_md?: string | null;
          provider?: string;
        };
        Relationships: [];
      };
      doc_source: {
        Row: {
          as_of: string | null;
          char_count: number;
          created_at: string;
          doc_id: number;
          exposure: string;
          extractor: string;
          ingested_at: string;
          issuer: string | null;
          key: string;
          media_type: string;
          notes_md: string | null;
          page_count: number;
          source_path: string;
          source_sha256: string;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          as_of?: string | null;
          char_count: number;
          created_at?: string;
          doc_id?: never;
          exposure?: string;
          extractor: string;
          ingested_at?: string;
          issuer?: string | null;
          key: string;
          media_type?: string;
          notes_md?: string | null;
          page_count: number;
          source_path: string;
          source_sha256: string;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          as_of?: string | null;
          char_count?: number;
          created_at?: string;
          doc_id?: never;
          exposure?: string;
          extractor?: string;
          ingested_at?: string;
          issuer?: string | null;
          key?: string;
          media_type?: string;
          notes_md?: string | null;
          page_count?: number;
          source_path?: string;
          source_sha256?: string;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      fact_bhw_raw: {
        Row: {
          accreditation_year: number | null;
          accredited: boolean | null;
          active_years: number[] | null;
          active_years_count: number | null;
          age: number | null;
          bhw_id: number;
          bloodtype: string | null;
          civil_status: string | null;
          educational_attainment: string | null;
          first_active_year: number | null;
          geo_code: string;
          household: number | null;
          inactive_years: number[] | null;
          inactive_years_count: number | null;
          ingestion_batch_id: number | null;
          ip_status: string | null;
          last_active_year: number | null;
          ref_manual_trained: boolean | null;
          ref_manual_year: number | null;
          registered_year: number | null;
          sex: string | null;
          tesda_certified: boolean | null;
          tesda_certified_year: number | null;
          tesda_nc2: boolean | null;
          tesda_nc2_year: number | null;
          training: Json | null;
        };
        Insert: {
          accreditation_year?: number | null;
          accredited?: boolean | null;
          active_years?: number[] | null;
          active_years_count?: number | null;
          age?: number | null;
          bhw_id?: never;
          bloodtype?: string | null;
          civil_status?: string | null;
          educational_attainment?: string | null;
          first_active_year?: number | null;
          geo_code: string;
          household?: number | null;
          inactive_years?: number[] | null;
          inactive_years_count?: number | null;
          ingestion_batch_id?: number | null;
          ip_status?: string | null;
          last_active_year?: number | null;
          ref_manual_trained?: boolean | null;
          ref_manual_year?: number | null;
          registered_year?: number | null;
          sex?: string | null;
          tesda_certified?: boolean | null;
          tesda_certified_year?: number | null;
          tesda_nc2?: boolean | null;
          tesda_nc2_year?: number | null;
          training?: Json | null;
        };
        Update: {
          accreditation_year?: number | null;
          accredited?: boolean | null;
          active_years?: number[] | null;
          active_years_count?: number | null;
          age?: number | null;
          bhw_id?: never;
          bloodtype?: string | null;
          civil_status?: string | null;
          educational_attainment?: string | null;
          first_active_year?: number | null;
          geo_code?: string;
          household?: number | null;
          inactive_years?: number[] | null;
          inactive_years_count?: number | null;
          ingestion_batch_id?: number | null;
          ip_status?: string | null;
          last_active_year?: number | null;
          ref_manual_trained?: boolean | null;
          ref_manual_year?: number | null;
          registered_year?: number | null;
          sex?: string | null;
          tesda_certified?: boolean | null;
          tesda_certified_year?: number | null;
          tesda_nc2?: boolean | null;
          tesda_nc2_year?: number | null;
          training?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "fact_bhw_raw_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
          {
            foreignKeyName: "fact_bhw_raw_ingestion_batch_id_fkey";
            columns: ["ingestion_batch_id"];
            isOneToOne: false;
            referencedRelation: "ingestion_batches";
            referencedColumns: ["batch_id"];
          },
        ];
      };
      fact_honorarium: {
        Row: {
          amount: number | null;
          bhw_id: number;
          frequency: Database["public"]["Enums"]["honorarium_frequency_enum"] | null;
          id: number;
          normalized_monthly_amount: number | null;
          payer_level: Database["public"]["Enums"]["payer_level_enum"];
          receives: boolean;
          source_note: string | null;
        };
        Insert: {
          amount?: number | null;
          bhw_id: number;
          frequency?: Database["public"]["Enums"]["honorarium_frequency_enum"] | null;
          id?: never;
          normalized_monthly_amount?: number | null;
          payer_level: Database["public"]["Enums"]["payer_level_enum"];
          receives: boolean;
          source_note?: string | null;
        };
        Update: {
          amount?: number | null;
          bhw_id?: number;
          frequency?: Database["public"]["Enums"]["honorarium_frequency_enum"] | null;
          id?: never;
          normalized_monthly_amount?: number | null;
          payer_level?: Database["public"]["Enums"]["payer_level_enum"];
          receives?: boolean;
          source_note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "fact_honorarium_bhw_id_fkey";
            columns: ["bhw_id"];
            isOneToOne: false;
            referencedRelation: "fact_bhw_raw";
            referencedColumns: ["bhw_id"];
          },
        ];
      };
      fact_uuc_phc_indicators: {
        Row: {
          abr: number | null;
          abr_prov_ref: number | null;
          armed_conf: number | null;
          capped_indicators: string[];
          dataset_id: number;
          elcac_brgy: boolean | null;
          fic: number | null;
          fic_prov_ref: number | null;
          four_ps: number | null;
          geo_code: string;
          health_indicators: number | null;
          id: number;
          idp: number | null;
          imr: number | null;
          imr_prov_ref: number | null;
          ip_pop: number | null;
          physical_factor: number | null;
          pre_natal: number | null;
          pre_natal_prov_ref: number | null;
          sba: number | null;
          sba_prov_ref: number | null;
          ufmr: number | null;
          ufmr_prov_ref: number | null;
          water: number | null;
          water_prov_ref: number | null;
        };
        Insert: {
          abr?: number | null;
          abr_prov_ref?: number | null;
          armed_conf?: number | null;
          capped_indicators?: string[];
          dataset_id: number;
          elcac_brgy?: boolean | null;
          fic?: number | null;
          fic_prov_ref?: number | null;
          four_ps?: number | null;
          geo_code: string;
          health_indicators?: number | null;
          id?: never;
          idp?: number | null;
          imr?: number | null;
          imr_prov_ref?: number | null;
          ip_pop?: number | null;
          physical_factor?: number | null;
          pre_natal?: number | null;
          pre_natal_prov_ref?: number | null;
          sba?: number | null;
          sba_prov_ref?: number | null;
          ufmr?: number | null;
          ufmr_prov_ref?: number | null;
          water?: number | null;
          water_prov_ref?: number | null;
        };
        Update: {
          abr?: number | null;
          abr_prov_ref?: number | null;
          armed_conf?: number | null;
          capped_indicators?: string[];
          dataset_id?: number;
          elcac_brgy?: boolean | null;
          fic?: number | null;
          fic_prov_ref?: number | null;
          four_ps?: number | null;
          geo_code?: string;
          health_indicators?: number | null;
          id?: never;
          idp?: number | null;
          imr?: number | null;
          imr_prov_ref?: number | null;
          ip_pop?: number | null;
          physical_factor?: number | null;
          pre_natal?: number | null;
          pre_natal_prov_ref?: number | null;
          sba?: number | null;
          sba_prov_ref?: number | null;
          ufmr?: number | null;
          ufmr_prov_ref?: number | null;
          water?: number | null;
          water_prov_ref?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "fact_uuc_phc_indicators_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "fact_uuc_phc_indicators_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      fact_uuc_phc_barangay: {
        Row: {
          dataset_id: number;
          geo_code: string;
          id: number;
          source_barangay: string | null;
          source_citymun: string | null;
          source_geo_code: string;
          source_province: string | null;
          source_region: string | null;
        };
        Insert: {
          dataset_id: number;
          geo_code: string;
          id?: never;
          source_barangay?: string | null;
          source_citymun?: string | null;
          source_geo_code: string;
          source_province?: string | null;
          source_region?: string | null;
        };
        Update: {
          dataset_id?: number;
          geo_code?: string;
          id?: never;
          source_barangay?: string | null;
          source_citymun?: string | null;
          source_geo_code?: string;
          source_province?: string | null;
          source_region?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "fact_uuc_phc_barangay_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "dim_dataset";
            referencedColumns: ["dataset_id"];
          },
          {
            foreignKeyName: "fact_uuc_phc_barangay_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
      feedback: {
        Row: {
          category: Database["public"]["Enums"]["feedback_category_enum"];
          context: Json | null;
          created_at: string;
          dataset_slug: string | null;
          email: string | null;
          id: number;
          message: string;
          page_path: string;
          page_url: string | null;
          screenshot_path: string | null;
          session_id: string;
          status: Database["public"]["Enums"]["feedback_status_enum"];
          target_selector: string | null;
        };
        Insert: {
          category: Database["public"]["Enums"]["feedback_category_enum"];
          context?: Json | null;
          created_at?: string;
          dataset_slug?: string | null;
          email?: string | null;
          id?: never;
          message: string;
          page_path: string;
          page_url?: string | null;
          screenshot_path?: string | null;
          session_id: string;
          status?: Database["public"]["Enums"]["feedback_status_enum"];
          target_selector?: string | null;
        };
        Update: {
          category?: Database["public"]["Enums"]["feedback_category_enum"];
          context?: Json | null;
          created_at?: string;
          dataset_slug?: string | null;
          email?: string | null;
          id?: never;
          message?: string;
          page_path?: string;
          page_url?: string | null;
          screenshot_path?: string | null;
          session_id?: string;
          status?: Database["public"]["Enums"]["feedback_status_enum"];
          target_selector?: string | null;
        };
        Relationships: [];
      };
      ingestion_batches: {
        Row: {
          batch_id: number;
          finished_at: string | null;
          qa_report: Json | null;
          row_counts: Json | null;
          source_file: string | null;
          started_at: string;
        };
        Insert: {
          batch_id?: never;
          finished_at?: string | null;
          qa_report?: Json | null;
          row_counts?: Json | null;
          source_file?: string | null;
          started_at?: string;
        };
        Update: {
          batch_id?: never;
          finished_at?: string | null;
          qa_report?: Json | null;
          row_counts?: Json | null;
          source_file?: string | null;
          started_at?: string;
        };
        Relationships: [];
      };
      kb_edge: {
        Row: {
          created_at: string;
          dst_node_id: number;
          edge_id: number;
          note: string | null;
          origin: string;
          relation: string;
          source_chunk_id: number | null;
          source_kind: string;
          source_ref: string;
          src_node_id: number;
          status: string;
          updated_at: string;
          valid_from: string | null;
          valid_to: string | null;
        };
        Insert: {
          created_at?: string;
          dst_node_id: number;
          edge_id?: never;
          note?: string | null;
          origin?: string;
          relation: string;
          source_chunk_id?: number | null;
          source_kind: string;
          source_ref: string;
          src_node_id: number;
          status?: string;
          updated_at?: string;
          valid_from?: string | null;
          valid_to?: string | null;
        };
        Update: {
          created_at?: string;
          dst_node_id?: number;
          edge_id?: never;
          note?: string | null;
          origin?: string;
          relation?: string;
          source_chunk_id?: number | null;
          source_kind?: string;
          source_ref?: string;
          src_node_id?: number;
          status?: string;
          updated_at?: string;
          valid_from?: string | null;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "kb_edge_src_node_id_fkey";
            columns: ["src_node_id"];
            isOneToOne: false;
            referencedRelation: "kb_node";
            referencedColumns: ["node_id"];
          },
          {
            foreignKeyName: "kb_edge_dst_node_id_fkey";
            columns: ["dst_node_id"];
            isOneToOne: false;
            referencedRelation: "kb_node";
            referencedColumns: ["node_id"];
          },
        ];
      };
      kb_node: {
        Row: {
          created_at: string;
          key: string;
          kind: string;
          label: string;
          node_id: number;
          origin: string;
          source_chunk_id: number | null;
          source_kind: string;
          source_ref: string;
          status: string;
          summary: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          key: string;
          kind: string;
          label: string;
          node_id?: never;
          origin?: string;
          source_chunk_id?: number | null;
          source_kind: string;
          source_ref: string;
          status?: string;
          summary?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          key?: string;
          kind?: string;
          label?: string;
          node_id?: never;
          origin?: string;
          source_chunk_id?: number | null;
          source_kind?: string;
          source_ref?: string;
          status?: string;
          summary?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      usage_events: {
        Row: {
          created_at: string;
          event_type: string;
          geo_code: string | null;
          id: number;
          ip_hash: string | null;
          meta: Json | null;
          page_path: string | null;
          session_id: string;
        };
        Insert: {
          created_at?: string;
          event_type: string;
          geo_code?: string | null;
          id?: never;
          ip_hash?: string | null;
          meta?: Json | null;
          page_path?: string | null;
          session_id: string;
        };
        Update: {
          created_at?: string;
          event_type?: string;
          geo_code?: string | null;
          id?: never;
          ip_hash?: string | null;
          meta?: Json | null;
          page_path?: string | null;
          session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "usage_events_geo_code_fkey";
            columns: ["geo_code"];
            isOneToOne: false;
            referencedRelation: "dim_geo";
            referencedColumns: ["geo_code"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      map_psgc_to_dim_geo: {
        Args: { p_code: string; p_old_vintage?: string };
        Returns: string;
      };
      match_ask_answer: {
        Args: { min_sim?: number; q: string; scope: string; version: string };
        Returns: {
          answer_md: string;
          cache_key: string;
          provider: string | null;
          question_norm: string;
          score: number;
        }[];
      };
      search_geo: {
        Args: { result_limit?: number; search_query: string };
        Returns: {
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          geo_name: string;
          match_rank: number;
          n_total: number;
          parent_chain: Json | null;
        }[];
      };
      traverse_geo: {
        Args: { direction?: string; max_depth?: number; row_cap?: number; start_code: string };
        Returns: {
          depth: number;
          geo_code: string;
          geo_level: Database["public"]["Enums"]["geo_level_enum"];
          geo_name: string;
          path: string[];
        }[];
      };
      search_documents: {
        Args: {
          p_doc_key?: string | null;
          p_embedding?: string | null;
          p_limit?: number;
          p_min_lexical?: number;
          p_model?: string | null;
          p_query: string;
        };
        Returns: {
          char_end: number;
          char_start: number;
          chunk_id: number;
          content: string;
          doc_as_of: string | null;
          doc_key: string;
          doc_title: string;
          heading: string | null;
          lexical_score: number | null;
          matched_by: string;
          page_from: number;
          page_to: number;
          score: number;
          vector_distance: number | null;
        }[];
      };
      traverse_kb: {
        Args: {
          direction?: string;
          max_depth?: number;
          relations?: string[];
          row_cap?: number;
          start_key: string;
        };
        Returns: {
          depth: number;
          key: string;
          kind: string;
          label: string;
          path: string[];
          relation_path: string[];
          source_path: string[];
        }[];
      };
      wilson_high: { Args: { k: number; n: number }; Returns: number };
      wilson_low: { Args: { k: number; n: number }; Returns: number };
    };
    Enums: {
      admin_role_enum: "admin" | "editor";
      demographic_dimension_enum:
        "sex" | "age_band" | "civil_status" | "bloodtype" | "education" | "ip_status";
      feedback_category_enum: "bug" | "data_question" | "suggestion" | "other";
      feedback_status_enum: "open" | "resolved" | "dismissed";
      geo_level_enum: "national" | "region" | "province" | "citymun" | "barangay";
      honorarium_frequency_enum: "monthly" | "quarterly" | "semi_annual" | "annual" | "other";
      payer_level_enum: "region" | "province" | "citymun" | "barangay";
      quota_window_enum: "minute" | "day" | "month";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      admin_role_enum: ["admin", "editor"],
      demographic_dimension_enum: [
        "sex",
        "age_band",
        "civil_status",
        "bloodtype",
        "education",
        "ip_status",
      ],
      feedback_category_enum: ["bug", "data_question", "suggestion", "other"],
      feedback_status_enum: ["open", "resolved", "dismissed"],
      geo_level_enum: ["national", "region", "province", "citymun", "barangay"],
      honorarium_frequency_enum: ["monthly", "quarterly", "semi_annual", "annual", "other"],
      payer_level_enum: ["region", "province", "citymun", "barangay"],
      quota_window_enum: ["minute", "day", "month"],
    },
  },
} as const;
