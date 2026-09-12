export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      merchant_ad_connections: {
        Row: {
          access_token_ciphertext: string | null;
          created_at: string;
          id: string;
          last_synced_at: string | null;
          last_synced_end_date: string | null;
          last_synced_start_date: string | null;
          merchant_id: string;
          metadata: Json;
          account_timezone: string | null;
          attribution_metadata: Json;
          provider: string;
          provider_account_label: string | null;
          provider_customer_id: string | null;
          refresh_token_ciphertext: string | null;
          scopes: string[];
          status: string;
          sync_run_id: string | null;
          sync_run_started_at: string | null;
          token_expires_at: string | null;
          updated_at: string;
        };
        Insert: {
          access_token_ciphertext?: string | null;
          created_at?: string;
          id?: string;
          last_synced_at?: string | null;
          last_synced_end_date?: string | null;
          last_synced_start_date?: string | null;
          merchant_id: string;
          metadata?: Json;
          account_timezone?: string | null;
          attribution_metadata?: Json;
          provider?: string;
          provider_account_label?: string | null;
          provider_customer_id?: string | null;
          refresh_token_ciphertext?: string | null;
          scopes?: string[];
          status?: string;
          sync_run_id?: string | null;
          sync_run_started_at?: string | null;
          token_expires_at?: string | null;
          updated_at?: string;
        };
        Update: {
          access_token_ciphertext?: string | null;
          created_at?: string;
          id?: string;
          last_synced_at?: string | null;
          last_synced_end_date?: string | null;
          last_synced_start_date?: string | null;
          merchant_id?: string;
          metadata?: Json;
          account_timezone?: string | null;
          attribution_metadata?: Json;
          provider?: string;
          provider_account_label?: string | null;
          provider_customer_id?: string | null;
          refresh_token_ciphertext?: string | null;
          scopes?: string[];
          status?: string;
          sync_run_id?: string | null;
          sync_run_started_at?: string | null;
          token_expires_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'merchant_ad_connections_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
        ];
      };
      merchant_ad_spend_daily: {
        Row: {
          account_timezone: string | null;
          attribution_metadata: Json;
          clicks: string;
          conversions: string;
          created_at: string;
          currency_code: string;
          fetched_at: string;
          id: string;
          impressions: string;
          merchant_id: string;
          provider: string;
          provider_customer_id: string;
          reach: string | null;
          spend_amount_decimal: string | null;
          spend_date: string;
          spend_micros: string;
          updated_at: string;
        };
        Insert: {
          account_timezone?: string | null;
          attribution_metadata?: Json;
          clicks?: string;
          conversions?: string;
          created_at?: string;
          currency_code: string;
          fetched_at?: string;
          id?: string;
          impressions?: string;
          merchant_id: string;
          provider?: string;
          provider_customer_id: string;
          reach?: string | null;
          spend_amount_decimal?: string | null;
          spend_date: string;
          spend_micros?: string;
          updated_at?: string;
        };
        Update: {
          account_timezone?: string | null;
          attribution_metadata?: Json;
          clicks?: string;
          conversions?: string;
          created_at?: string;
          currency_code?: string;
          fetched_at?: string;
          id?: string;
          impressions?: string;
          merchant_id?: string;
          provider?: string;
          provider_customer_id?: string;
          reach?: string | null;
          spend_amount_decimal?: string | null;
          spend_date?: string;
          spend_micros?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'merchant_ad_spend_daily_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
        ];
      };
      agentic_cart_sessions: {
        Row: {
          agent_id: string | null;
          buyer: Json;
          cart_id: string;
          cart_items: Json;
          checkout_session_id: string | null;
          created_at: string;
          currency: string;
          expires_at: string;
          id: string;
          merchant_id: string;
          metadata: Json;
          shipping_address: Json | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          agent_id?: string | null;
          buyer?: Json;
          cart_id: string;
          cart_items?: Json;
          checkout_session_id?: string | null;
          created_at?: string;
          currency?: string;
          expires_at?: string;
          id?: string;
          merchant_id: string;
          metadata?: Json;
          shipping_address?: Json | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          agent_id?: string | null;
          buyer?: Json;
          cart_id?: string;
          cart_items?: Json;
          checkout_session_id?: string | null;
          created_at?: string;
          currency?: string;
          expires_at?: string;
          id?: string;
          merchant_id?: string;
          metadata?: Json;
          shipping_address?: Json | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'agentic_cart_sessions_checkout_session_id_fkey';
            columns: ['checkout_session_id'];
            isOneToOne: false;
            referencedRelation: 'checkout_sessions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'agentic_cart_sessions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'agentic_cart_sessions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'agentic_cart_sessions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      agentic_idempotency_records: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          idempotency_key: string;
          merchant_id: string;
          request_hash: string;
          response_body: Json | null;
          route: string;
          status_code: number | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          id?: string;
          idempotency_key: string;
          merchant_id: string;
          request_hash: string;
          response_body?: Json | null;
          route: string;
          status_code?: number | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          idempotency_key?: string;
          merchant_id?: string;
          request_hash?: string;
          response_body?: Json | null;
          route?: string;
          status_code?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'agentic_idempotency_records_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'agentic_idempotency_records_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'agentic_idempotency_records_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      agentic_request_records: {
        Row: {
          agent_id: string | null;
          api_version: string;
          created_at: string;
          expires_at: string;
          id: string;
          idempotency_key: string | null;
          merchant_id: string;
          request_id: string;
          route: string | null;
          status_code: number | null;
        };
        Insert: {
          agent_id?: string | null;
          api_version: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          idempotency_key?: string | null;
          merchant_id: string;
          request_id: string;
          route?: string | null;
          status_code?: number | null;
        };
        Update: {
          agent_id?: string | null;
          api_version?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          idempotency_key?: string | null;
          merchant_id?: string;
          request_id?: string;
          route?: string | null;
          status_code?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'agentic_request_records_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'agentic_request_records_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'agentic_request_records_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      ai_generated_topics: {
        Row: {
          created_at: string | null;
          expires_at: string | null;
          generated_post_id: string | null;
          id: string;
          keywords: string[] | null;
          merchant_id: string;
          outline: string | null;
          relevance_score: number | null;
          search_volume_estimate: number | null;
          source: string | null;
          status: string | null;
          title_suggestion: string | null;
          topic: string;
        };
        Insert: {
          created_at?: string | null;
          expires_at?: string | null;
          generated_post_id?: string | null;
          id?: string;
          keywords?: string[] | null;
          merchant_id: string;
          outline?: string | null;
          relevance_score?: number | null;
          search_volume_estimate?: number | null;
          source?: string | null;
          status?: string | null;
          title_suggestion?: string | null;
          topic: string;
        };
        Update: {
          created_at?: string | null;
          expires_at?: string | null;
          generated_post_id?: string | null;
          id?: string;
          keywords?: string[] | null;
          merchant_id?: string;
          outline?: string | null;
          relevance_score?: number | null;
          search_volume_estimate?: number | null;
          source?: string | null;
          status?: string | null;
          title_suggestion?: string | null;
          topic?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_generated_topics_generated_post_id_fkey';
            columns: ['generated_post_id'];
            isOneToOne: false;
            referencedRelation: 'blog_posts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_generated_topics_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'ai_generated_topics_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_generated_topics_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      ai_hero_images: {
        Row: {
          category: string;
          created_at: string | null;
          id: string;
          image_prompt: string;
          image_url: string;
          is_active: boolean | null;
          style_variant: string;
          updated_at: string | null;
          usage_count: number | null;
        };
        Insert: {
          category: string;
          created_at?: string | null;
          id?: string;
          image_prompt: string;
          image_url: string;
          is_active?: boolean | null;
          style_variant: string;
          updated_at?: string | null;
          usage_count?: number | null;
        };
        Update: {
          category?: string;
          created_at?: string | null;
          id?: string;
          image_prompt?: string;
          image_url?: string;
          is_active?: boolean | null;
          style_variant?: string;
          updated_at?: string | null;
          usage_count?: number | null;
        };
        Relationships: [];
      };
      ai_jobs: {
        Row: {
          attempts: number;
          completed_at: string | null;
          created_at: string | null;
          error: string | null;
          id: string;
          idempotency_key: string | null;
          input: Json;
          lease_expires_at: string | null;
          locked_at: string | null;
          locked_by: string | null;
          max_attempts: number;
          merchant_id: string;
          metadata: Json;
          model: string | null;
          next_run_at: string;
          output: Json | null;
          result_applied_at: string | null;
          started_at: string | null;
          status: string;
          type: string;
          updated_at: string | null;
        };
        Insert: {
          attempts?: number;
          completed_at?: string | null;
          created_at?: string | null;
          error?: string | null;
          id?: string;
          idempotency_key?: string | null;
          input: Json;
          lease_expires_at?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          merchant_id: string;
          metadata?: Json;
          model?: string | null;
          next_run_at?: string;
          output?: Json | null;
          result_applied_at?: string | null;
          started_at?: string | null;
          status?: string;
          type: string;
          updated_at?: string | null;
        };
        Update: {
          attempts?: number;
          completed_at?: string | null;
          created_at?: string | null;
          error?: string | null;
          id?: string;
          idempotency_key?: string | null;
          input?: Json;
          lease_expires_at?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          merchant_id?: string;
          metadata?: Json;
          model?: string | null;
          next_run_at?: string;
          output?: Json | null;
          result_applied_at?: string | null;
          started_at?: string | null;
          status?: string;
          type?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_jobs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'ai_jobs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_jobs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      analytics_events: {
        Row: {
          created_at: string | null;
          embedding: string | null;
          event_data: Json;
          event_id: string | null;
          event_timestamp: string | null;
          event_type: string;
          id: string;
          merchant_id: string;
          source: string | null;
        };
        Insert: {
          created_at?: string | null;
          embedding?: string | null;
          event_data: Json;
          event_id?: string | null;
          event_timestamp?: string | null;
          event_type: string;
          id?: string;
          merchant_id: string;
          source?: string | null;
        };
        Update: {
          created_at?: string | null;
          embedding?: string | null;
          event_data?: Json;
          event_id?: string | null;
          event_timestamp?: string | null;
          event_type?: string;
          id?: string;
          merchant_id?: string;
          source?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'analytics_events_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'analytics_events_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'analytics_events_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      audit_events: {
        Row: {
          action: string;
          actor_label: string | null;
          actor_type: string;
          actor_user_id: string | null;
          after_values: Json | null;
          before_values: Json | null;
          changed_fields: string[];
          correlation_id: string | null;
          database_transaction_id: string;
          id: string;
          merchant_id: string;
          merchant_label: string | null;
          metadata: Json;
          occurred_at: string;
          request_id: string | null;
          resource_id: string;
          resource_type: string;
          schema_version: number;
          source: string;
        };
        Insert: {
          action: string;
          actor_label?: string | null;
          actor_type: string;
          actor_user_id?: string | null;
          after_values?: Json | null;
          before_values?: Json | null;
          changed_fields?: string[];
          correlation_id?: string | null;
          database_transaction_id: string;
          id?: string;
          merchant_id: string;
          merchant_label?: string | null;
          metadata?: Json;
          occurred_at?: string;
          request_id?: string | null;
          resource_id: string;
          resource_type: string;
          schema_version?: number;
          source: string;
        };
        Update: {
          action?: string;
          actor_label?: string | null;
          actor_type?: string;
          actor_user_id?: string | null;
          after_values?: Json | null;
          before_values?: Json | null;
          changed_fields?: string[];
          correlation_id?: string | null;
          database_transaction_id?: string;
          id?: string;
          merchant_id?: string;
          merchant_label?: string | null;
          metadata?: Json;
          occurred_at?: string;
          request_id?: string | null;
          resource_id?: string;
          resource_type?: string;
          schema_version?: number;
          source?: string;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          action: string;
          changes: Json | null;
          error_message: string | null;
          id: string;
          ip_address: string | null;
          merchant_id: string | null;
          resource_id: string;
          resource_type: string;
          status: string;
          timestamp: string;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          action: string;
          changes?: Json | null;
          error_message?: string | null;
          id?: string;
          ip_address?: string | null;
          merchant_id?: string | null;
          resource_id: string;
          resource_type: string;
          status: string;
          timestamp?: string;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          action?: string;
          changes?: Json | null;
          error_message?: string | null;
          id?: string;
          ip_address?: string | null;
          merchant_id?: string | null;
          resource_id?: string;
          resource_type?: string;
          status?: string;
          timestamp?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_logs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'audit_logs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_logs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      blog_categories: {
        Row: {
          color: string | null;
          created_at: string | null;
          description: string | null;
          icon: string | null;
          id: string;
          merchant_id: string;
          name: string;
          post_count: number | null;
          slug: string;
          updated_at: string | null;
        };
        Insert: {
          color?: string | null;
          created_at?: string | null;
          description?: string | null;
          icon?: string | null;
          id?: string;
          merchant_id: string;
          name: string;
          post_count?: number | null;
          slug: string;
          updated_at?: string | null;
        };
        Update: {
          color?: string | null;
          created_at?: string | null;
          description?: string | null;
          icon?: string | null;
          id?: string;
          merchant_id?: string;
          name?: string;
          post_count?: number | null;
          slug?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'blog_categories_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'blog_categories_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'blog_categories_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      blog_post_products: {
        Row: {
          blog_post_id: string;
          created_at: string;
          id: string;
          merchant_id: string;
          position: number;
          product_id: string;
          relationship: string;
        };
        Insert: {
          blog_post_id: string;
          created_at?: string;
          id?: string;
          merchant_id: string;
          position: number;
          product_id: string;
          relationship?: string;
        };
        Update: {
          blog_post_id?: string;
          created_at?: string;
          id?: string;
          merchant_id?: string;
          position?: number;
          product_id?: string;
          relationship?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'blog_post_products_blog_post_id_fkey';
            columns: ['blog_post_id'];
            isOneToOne: false;
            referencedRelation: 'blog_posts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'blog_post_products_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'blog_post_products_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'blog_post_products_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'blog_post_products_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'low_stock_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'blog_post_products_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'blog_post_products_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'blog_post_products_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'secure_product_performance';
            referencedColumns: ['product_id'];
          },
        ];
      };
      blog_post_redirects: {
        Row: {
          created_at: string;
          id: string;
          merchant_id: string;
          source_slug: string;
          target_post_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          merchant_id: string;
          source_slug: string;
          target_post_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          merchant_id?: string;
          source_slug?: string;
          target_post_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'blog_post_redirects_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'blog_post_redirects_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'blog_post_redirects_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'blog_post_redirects_target_post_id_fkey';
            columns: ['target_post_id'];
            isOneToOne: false;
            referencedRelation: 'blog_posts';
            referencedColumns: ['id'];
          },
        ];
      };
      blog_posts: {
        Row: {
          ai_topic_id: string | null;
          author_bio: string | null;
          author_image_url: string | null;
          author_name: string;
          author_title: string | null;
          category: string | null;
          content: string;
          content_embedding: string | null;
          created_at: string | null;
          excerpt: string | null;
          featured_image_alt: string | null;
          featured_image_height: number | null;
          featured_image_url: string | null;
          featured_image_variants: Json;
          featured_image_width: number | null;
          focus_keyword: string | null;
          id: string;
          is_ai_generated: boolean | null;
          is_platform_post: boolean | null;
          keywords: string[] | null;
          merchant_id: string | null;
          published_at: string | null;
          reading_time_minutes: number | null;
          search_vector: unknown;
          seo_description: string | null;
          seo_title: string | null;
          slug: string;
          status: string | null;
          tags: string[] | null;
          title: string;
          updated_at: string | null;
          view_count: number | null;
          word_count: number | null;
        };
        Insert: {
          ai_topic_id?: string | null;
          author_bio?: string | null;
          author_image_url?: string | null;
          author_name: string;
          author_title?: string | null;
          category?: string | null;
          content: string;
          content_embedding?: string | null;
          created_at?: string | null;
          excerpt?: string | null;
          featured_image_alt?: string | null;
          featured_image_height?: number | null;
          featured_image_url?: string | null;
          featured_image_variants?: Json;
          featured_image_width?: number | null;
          focus_keyword?: string | null;
          id?: string;
          is_ai_generated?: boolean | null;
          is_platform_post?: boolean | null;
          keywords?: string[] | null;
          merchant_id?: string | null;
          published_at?: string | null;
          reading_time_minutes?: number | null;
          search_vector?: unknown;
          seo_description?: string | null;
          seo_title?: string | null;
          slug: string;
          status?: string | null;
          tags?: string[] | null;
          title: string;
          updated_at?: string | null;
          view_count?: number | null;
          word_count?: number | null;
        };
        Update: {
          ai_topic_id?: string | null;
          author_bio?: string | null;
          author_image_url?: string | null;
          author_name?: string;
          author_title?: string | null;
          category?: string | null;
          content?: string;
          content_embedding?: string | null;
          created_at?: string | null;
          excerpt?: string | null;
          featured_image_alt?: string | null;
          featured_image_height?: number | null;
          featured_image_url?: string | null;
          featured_image_variants?: Json;
          featured_image_width?: number | null;
          focus_keyword?: string | null;
          id?: string;
          is_ai_generated?: boolean | null;
          is_platform_post?: boolean | null;
          keywords?: string[] | null;
          merchant_id?: string | null;
          published_at?: string | null;
          reading_time_minutes?: number | null;
          search_vector?: unknown;
          seo_description?: string | null;
          seo_title?: string | null;
          slug?: string;
          status?: string | null;
          tags?: string[] | null;
          title?: string;
          updated_at?: string | null;
          view_count?: number | null;
          word_count?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'blog_posts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'blog_posts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'blog_posts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      branches: {
        Row: {
          active: boolean | null;
          address: string | null;
          city: string | null;
          created_at: string | null;
          id: string;
          is_default: boolean | null;
          manager_id: string | null;
          merchant_id: string;
          name: string;
          phone: string | null;
          state: string | null;
          updated_at: string | null;
        };
        Insert: {
          active?: boolean | null;
          address?: string | null;
          city?: string | null;
          created_at?: string | null;
          id?: string;
          is_default?: boolean | null;
          manager_id?: string | null;
          merchant_id: string;
          name: string;
          phone?: string | null;
          state?: string | null;
          updated_at?: string | null;
        };
        Update: {
          active?: boolean | null;
          address?: string | null;
          city?: string | null;
          created_at?: string | null;
          id?: string;
          is_default?: boolean | null;
          manager_id?: string | null;
          merchant_id?: string;
          name?: string;
          phone?: string | null;
          state?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'branches_manager_id_fkey';
            columns: ['manager_id'];
            isOneToOne: false;
            referencedRelation: 'staff_members';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'branches_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'branches_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'branches_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      brands: {
        Row: {
          created_at: string | null;
          description: string | null;
          display_order: number | null;
          id: string;
          is_active: boolean | null;
          logo_url: string | null;
          merchant_id: string;
          name: string;
          slug: string;
          updated_at: string | null;
          website_url: string | null;
        };
        Insert: {
          created_at?: string | null;
          description?: string | null;
          display_order?: number | null;
          id?: string;
          is_active?: boolean | null;
          logo_url?: string | null;
          merchant_id: string;
          name: string;
          slug: string;
          updated_at?: string | null;
          website_url?: string | null;
        };
        Update: {
          created_at?: string | null;
          description?: string | null;
          display_order?: number | null;
          id?: string;
          is_active?: boolean | null;
          logo_url?: string | null;
          merchant_id?: string;
          name?: string;
          slug?: string;
          updated_at?: string | null;
          website_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'brands_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'brands_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'brands_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      byok_fee_accruals: {
        Row: {
          created_at: string;
          currency: string;
          fee_amount: number;
          id: number;
          merchant_id: string;
          order_amount: number;
          order_id: string | null;
          provider: string;
          transaction_reference: string | null;
          waived: boolean;
        };
        Insert: {
          created_at?: string;
          currency: string;
          fee_amount?: number;
          id?: never;
          merchant_id: string;
          order_amount: number;
          order_id?: string | null;
          provider: string;
          transaction_reference?: string | null;
          waived?: boolean;
        };
        Update: {
          created_at?: string;
          currency?: string;
          fee_amount?: number;
          id?: never;
          merchant_id?: string;
          order_amount?: number;
          order_id?: string | null;
          provider?: string;
          transaction_reference?: string | null;
          waived?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'byok_fee_accruals_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'byok_fee_accruals_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'byok_fee_accruals_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      cache_invalidation_outbox: {
        Row: {
          attempts: number;
          claim_token: string | null;
          claimed_at: string | null;
          claimed_by: string | null;
          claimed_generation: number | null;
          completed_at: string | null;
          completed_generation: number | null;
          created_at: string;
          generation: number;
          last_error_code: string | null;
          max_attempts: number;
          merchant_id: string;
          next_attempt_at: string;
          product_slugs: string[];
          related_identifiers: string[];
          status: string;
          target_id: string;
          target_kind: string;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          claim_token?: string | null;
          claimed_at?: string | null;
          claimed_by?: string | null;
          claimed_generation?: number | null;
          completed_at?: string | null;
          completed_generation?: number | null;
          created_at?: string;
          generation?: number;
          last_error_code?: string | null;
          max_attempts?: number;
          merchant_id: string;
          next_attempt_at?: string;
          product_slugs?: string[];
          related_identifiers?: string[];
          status?: string;
          target_id: string;
          target_kind: string;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          claim_token?: string | null;
          claimed_at?: string | null;
          claimed_by?: string | null;
          claimed_generation?: number | null;
          completed_at?: string | null;
          completed_generation?: number | null;
          created_at?: string;
          generation?: number;
          last_error_code?: string | null;
          max_attempts?: number;
          merchant_id?: string;
          next_attempt_at?: string;
          product_slugs?: string[];
          related_identifiers?: string[];
          status?: string;
          target_id?: string;
          target_kind?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          buying_guide_url: string | null;
          created_at: string | null;
          description: string | null;
          display_order: number | null;
          id: string;
          image_url: string | null;
          is_active: boolean | null;
          merchant_id: string;
          metadata: Json | null;
          name: string;
          parent_id: string | null;
          seo_description: string | null;
          seo_faq: Json | null;
          seo_features: Json | null;
          seo_heading: string | null;
          slug: string;
          updated_at: string | null;
        };
        Insert: {
          buying_guide_url?: string | null;
          created_at?: string | null;
          description?: string | null;
          display_order?: number | null;
          id?: string;
          image_url?: string | null;
          is_active?: boolean | null;
          merchant_id: string;
          metadata?: Json | null;
          name: string;
          parent_id?: string | null;
          seo_description?: string | null;
          seo_faq?: Json | null;
          seo_features?: Json | null;
          seo_heading?: string | null;
          slug: string;
          updated_at?: string | null;
        };
        Update: {
          buying_guide_url?: string | null;
          created_at?: string | null;
          description?: string | null;
          display_order?: number | null;
          id?: string;
          image_url?: string | null;
          is_active?: boolean | null;
          merchant_id?: string;
          metadata?: Json | null;
          name?: string;
          parent_id?: string | null;
          seo_description?: string | null;
          seo_faq?: Json | null;
          seo_features?: Json | null;
          seo_heading?: string | null;
          slug?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'categories_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'categories_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'categories_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'categories_parent_id_fkey';
            columns: ['parent_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
        ];
      };
      chat_orders: {
        Row: {
          created_at: string | null;
          customer_email: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          id: string;
          items: Json;
          merchant_id: string;
          metadata: Json | null;
          paid_at: string | null;
          payment_method: string | null;
          payment_reference: string | null;
          session_id: string | null;
          shipping_address: Json | null;
          shipping_fee: number | null;
          status: string;
          subtotal: number;
          total: number | null;
          updated_at: string | null;
          virtual_account_bank: string | null;
          virtual_account_number: string | null;
        };
        Insert: {
          created_at?: string | null;
          customer_email?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          id?: string;
          items?: Json;
          merchant_id: string;
          metadata?: Json | null;
          paid_at?: string | null;
          payment_method?: string | null;
          payment_reference?: string | null;
          session_id?: string | null;
          shipping_address?: Json | null;
          shipping_fee?: number | null;
          status?: string;
          subtotal?: number;
          total?: number | null;
          updated_at?: string | null;
          virtual_account_bank?: string | null;
          virtual_account_number?: string | null;
        };
        Update: {
          created_at?: string | null;
          customer_email?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          id?: string;
          items?: Json;
          merchant_id?: string;
          metadata?: Json | null;
          paid_at?: string | null;
          payment_method?: string | null;
          payment_reference?: string | null;
          session_id?: string | null;
          shipping_address?: Json | null;
          shipping_fee?: number | null;
          status?: string;
          subtotal?: number;
          total?: number | null;
          updated_at?: string | null;
          virtual_account_bank?: string | null;
          virtual_account_number?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'chat_orders_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'chat_orders_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'chat_orders_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      checkout_sessions: {
        Row: {
          ad_tracking: Json | null;
          cart_items: Json;
          cart_total: number;
          created_at: string;
          currency: string;
          customer_email: string | null;
          customer_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          device_info: Json | null;
          discount_amount: number | null;
          discount_code: string | null;
          expires_at: string;
          id: string;
          merchant_id: string;
          metadata: Json;
          order_id: string | null;
          payment_method: string | null;
          payment_provider: string | null;
          payment_reference: string | null;
          session_id: string;
          shipping_address: Json | null;
          shipping_cost: number | null;
          shipping_method: string | null;
          status: string;
          subtotal: number;
          tax_amount: number | null;
          total_amount: number;
          updated_at: string;
          virtual_account_bank: string | null;
          virtual_account_expires_at: string | null;
          virtual_account_name: string | null;
          virtual_account_number: string | null;
        };
        Insert: {
          ad_tracking?: Json | null;
          cart_items?: Json;
          cart_total?: number;
          created_at?: string;
          currency?: string;
          customer_email?: string | null;
          customer_id?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          device_info?: Json | null;
          discount_amount?: number | null;
          discount_code?: string | null;
          expires_at?: string;
          id?: string;
          merchant_id: string;
          metadata?: Json;
          order_id?: string | null;
          payment_method?: string | null;
          payment_provider?: string | null;
          payment_reference?: string | null;
          session_id: string;
          shipping_address?: Json | null;
          shipping_cost?: number | null;
          shipping_method?: string | null;
          status?: string;
          subtotal?: number;
          tax_amount?: number | null;
          total_amount?: number;
          updated_at?: string;
          virtual_account_bank?: string | null;
          virtual_account_expires_at?: string | null;
          virtual_account_name?: string | null;
          virtual_account_number?: string | null;
        };
        Update: {
          ad_tracking?: Json | null;
          cart_items?: Json;
          cart_total?: number;
          created_at?: string;
          currency?: string;
          customer_email?: string | null;
          customer_id?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          device_info?: Json | null;
          discount_amount?: number | null;
          discount_code?: string | null;
          expires_at?: string;
          id?: string;
          merchant_id?: string;
          metadata?: Json;
          order_id?: string | null;
          payment_method?: string | null;
          payment_provider?: string | null;
          payment_reference?: string | null;
          session_id?: string;
          shipping_address?: Json | null;
          shipping_cost?: number | null;
          shipping_method?: string | null;
          status?: string;
          subtotal?: number;
          tax_amount?: number | null;
          total_amount?: number;
          updated_at?: string;
          virtual_account_bank?: string | null;
          virtual_account_expires_at?: string | null;
          virtual_account_name?: string | null;
          virtual_account_number?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'checkout_sessions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'checkout_sessions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checkout_sessions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checkout_sessions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'checkout_sessions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'checkout_sessions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checkout_sessions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'checkout_sessions_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      crawler_logs: {
        Row: {
          agent_family: string | null;
          bot_name: string;
          cache_outcome: string | null;
          crawled_at: string | null;
          host: string | null;
          id: string;
          merchant_id: string | null;
          response_time_ms: number | null;
          status_code: number | null;
          url_path: string;
          user_agent: string | null;
        };
        Insert: {
          agent_family?: string | null;
          bot_name: string;
          cache_outcome?: string | null;
          crawled_at?: string | null;
          host?: string | null;
          id?: string;
          merchant_id?: string | null;
          response_time_ms?: number | null;
          status_code?: number | null;
          url_path: string;
          user_agent?: string | null;
        };
        Update: {
          agent_family?: string | null;
          bot_name?: string;
          cache_outcome?: string | null;
          crawled_at?: string | null;
          host?: string | null;
          id?: string;
          merchant_id?: string | null;
          response_time_ms?: number | null;
          status_code?: number | null;
          url_path?: string;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'crawler_logs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'crawler_logs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'crawler_logs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      credit_direct_checkout_tokens: {
        Row: {
          consumed_at: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          merchant_id: string;
          order_id: string;
          session_id: string;
          signed_amount: number;
          token_hash: string;
        };
        Insert: {
          consumed_at?: string | null;
          created_at?: string;
          expires_at: string;
          id?: string;
          merchant_id: string;
          order_id: string;
          session_id: string;
          signed_amount: number;
          token_hash: string;
        };
        Update: {
          consumed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          merchant_id?: string;
          order_id?: string;
          session_id?: string;
          signed_amount?: number;
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'credit_direct_checkout_tokens_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'credit_direct_checkout_tokens_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'credit_direct_checkout_tokens_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'credit_direct_checkout_tokens_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      customer_loyalty: {
        Row: {
          created_at: string | null;
          current_tier: string | null;
          customer_id: string;
          id: string;
          lifetime_points: number | null;
          merchant_id: string;
          points_balance: number | null;
          referral_code: string | null;
          referral_count: number | null;
          referred_by_customer_id: string | null;
          tier_updated_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          current_tier?: string | null;
          customer_id: string;
          id?: string;
          lifetime_points?: number | null;
          merchant_id: string;
          points_balance?: number | null;
          referral_code?: string | null;
          referral_count?: number | null;
          referred_by_customer_id?: string | null;
          tier_updated_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          current_tier?: string | null;
          customer_id?: string;
          id?: string;
          lifetime_points?: number | null;
          merchant_id?: string;
          points_balance?: number | null;
          referral_code?: string | null;
          referral_count?: number | null;
          referred_by_customer_id?: string | null;
          tier_updated_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_loyalty_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_loyalty_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_loyalty_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_loyalty_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_loyalty_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customer_loyalty_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_loyalty_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customer_loyalty_referred_by_customer_id_fkey';
            columns: ['referred_by_customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_loyalty_referred_by_customer_id_fkey';
            columns: ['referred_by_customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_loyalty_referred_by_customer_id_fkey';
            columns: ['referred_by_customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_loyalty_referred_by_customer_id_fkey';
            columns: ['referred_by_customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
        ];
      };
      customer_rfm_scores: {
        Row: {
          average_order_value: number | null;
          churn_risk: number | null;
          churn_risk_level: string | null;
          clv_segment: string | null;
          customer_id: string;
          days_since_last_order: number | null;
          first_order_date: string | null;
          frequency_score: number | null;
          id: string;
          last_order_date: string | null;
          lifecycle_segment: string | null;
          merchant_id: string;
          monetary_score: number | null;
          predicted_clv: number | null;
          recency_score: number | null;
          rfm_score: number | null;
          rfm_segment: string | null;
          total_orders: number | null;
          total_spent: number | null;
          updated_at: string | null;
        };
        Insert: {
          average_order_value?: number | null;
          churn_risk?: number | null;
          churn_risk_level?: string | null;
          clv_segment?: string | null;
          customer_id: string;
          days_since_last_order?: number | null;
          first_order_date?: string | null;
          frequency_score?: number | null;
          id?: string;
          last_order_date?: string | null;
          lifecycle_segment?: string | null;
          merchant_id: string;
          monetary_score?: number | null;
          predicted_clv?: number | null;
          recency_score?: number | null;
          rfm_score?: number | null;
          rfm_segment?: string | null;
          total_orders?: number | null;
          total_spent?: number | null;
          updated_at?: string | null;
        };
        Update: {
          average_order_value?: number | null;
          churn_risk?: number | null;
          churn_risk_level?: string | null;
          clv_segment?: string | null;
          customer_id?: string;
          days_since_last_order?: number | null;
          first_order_date?: string | null;
          frequency_score?: number | null;
          id?: string;
          last_order_date?: string | null;
          lifecycle_segment?: string | null;
          merchant_id?: string;
          monetary_score?: number | null;
          predicted_clv?: number | null;
          recency_score?: number | null;
          rfm_score?: number | null;
          rfm_segment?: string | null;
          total_orders?: number | null;
          total_spent?: number | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_rfm_scores_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_rfm_scores_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_rfm_scores_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_rfm_scores_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_rfm_scores_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customer_rfm_scores_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_rfm_scores_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      customer_saved_payment_methods: {
        Row: {
          authorization_code: string;
          authorization_data: Json;
          authorization_signature: string;
          bank: string | null;
          brand: string | null;
          card_type: string | null;
          country_code: string | null;
          created_at: string;
          customer_id: string;
          disabled_at: string | null;
          exp_month: string | null;
          exp_year: string | null;
          id: string;
          is_active: boolean;
          is_default: boolean;
          last_used_at: string | null;
          last4: string | null;
          merchant_id: string;
          provider: string;
          provider_customer_email: string;
          reusable: boolean;
          updated_at: string;
        };
        Insert: {
          authorization_code: string;
          authorization_data?: Json;
          authorization_signature: string;
          bank?: string | null;
          brand?: string | null;
          card_type?: string | null;
          country_code?: string | null;
          created_at?: string;
          customer_id: string;
          disabled_at?: string | null;
          exp_month?: string | null;
          exp_year?: string | null;
          id?: string;
          is_active?: boolean;
          is_default?: boolean;
          last_used_at?: string | null;
          last4?: string | null;
          merchant_id: string;
          provider: string;
          provider_customer_email: string;
          reusable?: boolean;
          updated_at?: string;
        };
        Update: {
          authorization_code?: string;
          authorization_data?: Json;
          authorization_signature?: string;
          bank?: string | null;
          brand?: string | null;
          card_type?: string | null;
          country_code?: string | null;
          created_at?: string;
          customer_id?: string;
          disabled_at?: string | null;
          exp_month?: string | null;
          exp_year?: string | null;
          id?: string;
          is_active?: boolean;
          is_default?: boolean;
          last_used_at?: string | null;
          last4?: string | null;
          merchant_id?: string;
          provider?: string;
          provider_customer_email?: string;
          reusable?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_saved_payment_methods_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_saved_payment_methods_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_saved_payment_methods_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_saved_payment_methods_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_saved_payment_methods_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customer_saved_payment_methods_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_saved_payment_methods_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      customer_savings_contributions: {
        Row: {
          amount: number;
          created_at: string;
          customer_id: string;
          failed_at: string | null;
          failure_reason: string | null;
          goal_id: string;
          id: string;
          idempotency_key: string;
          merchant_id: string;
          metadata: Json;
          processed_at: string | null;
          saved_payment_method_id: string | null;
          scheduled_for: string | null;
          source_type: string;
          status: string;
          transaction_id: string | null;
          updated_at: string;
          wallet_transaction_id: string | null;
        };
        Insert: {
          amount: number;
          created_at?: string;
          customer_id: string;
          failed_at?: string | null;
          failure_reason?: string | null;
          goal_id: string;
          id?: string;
          idempotency_key: string;
          merchant_id: string;
          metadata?: Json;
          processed_at?: string | null;
          saved_payment_method_id?: string | null;
          scheduled_for?: string | null;
          source_type: string;
          status?: string;
          transaction_id?: string | null;
          updated_at?: string;
          wallet_transaction_id?: string | null;
        };
        Update: {
          amount?: number;
          created_at?: string;
          customer_id?: string;
          failed_at?: string | null;
          failure_reason?: string | null;
          goal_id?: string;
          id?: string;
          idempotency_key?: string;
          merchant_id?: string;
          metadata?: Json;
          processed_at?: string | null;
          saved_payment_method_id?: string | null;
          scheduled_for?: string | null;
          source_type?: string;
          status?: string;
          transaction_id?: string | null;
          updated_at?: string;
          wallet_transaction_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_savings_contributions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_savings_contributions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_contributions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_contributions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_savings_contributions_goal_id_fkey';
            columns: ['goal_id'];
            isOneToOne: false;
            referencedRelation: 'customer_savings_goals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_contributions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customer_savings_contributions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_contributions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customer_savings_contributions_saved_payment_method_id_fkey';
            columns: ['saved_payment_method_id'];
            isOneToOne: false;
            referencedRelation: 'customer_saved_payment_methods';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_contributions_transaction_id_fkey';
            columns: ['transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_contributions_wallet_transaction_id_fkey';
            columns: ['wallet_transaction_id'];
            isOneToOne: false;
            referencedRelation: 'customer_wallet_transactions';
            referencedColumns: ['id'];
          },
        ];
      };
      customer_savings_events: {
        Row: {
          actor_id: string | null;
          actor_type: string;
          created_at: string;
          customer_id: string;
          event_type: string;
          goal_id: string;
          id: string;
          merchant_id: string;
          metadata: Json;
        };
        Insert: {
          actor_id?: string | null;
          actor_type?: string;
          created_at?: string;
          customer_id: string;
          event_type: string;
          goal_id: string;
          id?: string;
          merchant_id: string;
          metadata?: Json;
        };
        Update: {
          actor_id?: string | null;
          actor_type?: string;
          created_at?: string;
          customer_id?: string;
          event_type?: string;
          goal_id?: string;
          id?: string;
          merchant_id?: string;
          metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_savings_events_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_savings_events_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_events_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_events_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_savings_events_goal_id_fkey';
            columns: ['goal_id'];
            isOneToOne: false;
            referencedRelation: 'customer_savings_goals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_events_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customer_savings_events_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_events_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      customer_savings_goals: {
        Row: {
          applied_order_id: string | null;
          auto_debit_authorized_at: string | null;
          break_fee_percent: number;
          cancelled_at: string | null;
          completed_at: string | null;
          contribution_amount: number;
          contribution_frequency: string;
          created_at: string;
          current_amount: number;
          customer_id: string;
          early_end_fee_accepted_at: string | null;
          future_debits_cancelled_at: string | null;
          id: string;
          initial_contribution_amount: number;
          maturity_date: string;
          merchant_id: string;
          metadata: Json;
          non_withdrawable_accepted_at: string;
          preferred_debit_time: string | null;
          product_id: string;
          product_snapshot: Json;
          saved_payment_method_id: string | null;
          source_mode: string;
          spent_at: string | null;
          start_date: string;
          status: string;
          target_amount: number;
          terms_accepted_at: string;
          title: string;
          updated_at: string;
          variant_id: string | null;
        };
        Insert: {
          applied_order_id?: string | null;
          auto_debit_authorized_at?: string | null;
          break_fee_percent?: number;
          cancelled_at?: string | null;
          completed_at?: string | null;
          contribution_amount: number;
          contribution_frequency: string;
          created_at?: string;
          current_amount?: number;
          customer_id: string;
          early_end_fee_accepted_at?: string | null;
          future_debits_cancelled_at?: string | null;
          id?: string;
          initial_contribution_amount?: number;
          maturity_date: string;
          merchant_id: string;
          metadata?: Json;
          non_withdrawable_accepted_at: string;
          preferred_debit_time?: string | null;
          product_id: string;
          product_snapshot?: Json;
          saved_payment_method_id?: string | null;
          source_mode: string;
          spent_at?: string | null;
          start_date: string;
          status?: string;
          target_amount: number;
          terms_accepted_at: string;
          title: string;
          updated_at?: string;
          variant_id?: string | null;
        };
        Update: {
          applied_order_id?: string | null;
          auto_debit_authorized_at?: string | null;
          break_fee_percent?: number;
          cancelled_at?: string | null;
          completed_at?: string | null;
          contribution_amount?: number;
          contribution_frequency?: string;
          created_at?: string;
          current_amount?: number;
          customer_id?: string;
          early_end_fee_accepted_at?: string | null;
          future_debits_cancelled_at?: string | null;
          id?: string;
          initial_contribution_amount?: number;
          maturity_date?: string;
          merchant_id?: string;
          metadata?: Json;
          non_withdrawable_accepted_at?: string;
          preferred_debit_time?: string | null;
          product_id?: string;
          product_snapshot?: Json;
          saved_payment_method_id?: string | null;
          source_mode?: string;
          spent_at?: string | null;
          start_date?: string;
          status?: string;
          target_amount?: number;
          terms_accepted_at?: string;
          title?: string;
          updated_at?: string;
          variant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_savings_goals_applied_order_id_fkey';
            columns: ['applied_order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_goals_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_savings_goals_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_goals_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_goals_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_savings_goals_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customer_savings_goals_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_goals_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customer_savings_goals_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'low_stock_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_goals_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'customer_savings_goals_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_goals_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'secure_product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'customer_savings_goals_saved_payment_method_id_fkey';
            columns: ['saved_payment_method_id'];
            isOneToOne: false;
            referencedRelation: 'customer_saved_payment_methods';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_goals_variant_id_fkey';
            columns: ['variant_id'];
            isOneToOne: false;
            referencedRelation: 'product_variants';
            referencedColumns: ['id'];
          },
        ];
      };
      customer_savings_redemptions: {
        Row: {
          amount: number;
          created_at: string;
          customer_id: string;
          goal_id: string;
          id: string;
          idempotency_key: string;
          merchant_id: string;
          metadata: Json;
          order_id: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          customer_id: string;
          goal_id: string;
          id?: string;
          idempotency_key: string;
          merchant_id: string;
          metadata?: Json;
          order_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          customer_id?: string;
          goal_id?: string;
          id?: string;
          idempotency_key?: string;
          merchant_id?: string;
          metadata?: Json;
          order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_savings_redemptions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_savings_redemptions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_redemptions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_redemptions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_savings_redemptions_goal_id_fkey';
            columns: ['goal_id'];
            isOneToOne: false;
            referencedRelation: 'customer_savings_goals';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_redemptions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customer_savings_redemptions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_savings_redemptions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customer_savings_redemptions_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      customer_wallet_account_transactions: {
        Row: {
          account_id: string;
          amount: number;
          balance_after: number;
          created_at: string;
          currency: string;
          customer_id: string;
          description: string | null;
          id: string;
          merchant_id: string;
          metadata: Json;
          source_id: string;
          source_type: string;
          type: string;
        };
        Insert: {
          account_id: string;
          amount: number;
          balance_after: number;
          created_at?: string;
          currency: string;
          customer_id: string;
          description?: string | null;
          id?: string;
          merchant_id: string;
          metadata?: Json;
          source_id: string;
          source_type: string;
          type: string;
        };
        Update: {
          account_id?: string;
          amount?: number;
          balance_after?: number;
          created_at?: string;
          currency?: string;
          customer_id?: string;
          description?: string | null;
          id?: string;
          merchant_id?: string;
          metadata?: Json;
          source_id?: string;
          source_type?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_wallet_account_transactions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'customer_wallet_accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_wallet_account_transactions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_wallet_account_transactions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_wallet_account_transactions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_wallet_account_transactions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_wallet_account_transactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customer_wallet_account_transactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_wallet_account_transactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      customer_wallet_accounts: {
        Row: {
          available_balance: number;
          created_at: string;
          currency: string;
          customer_id: string;
          id: string;
          merchant_id: string;
          total_credited: number;
          total_debited: number;
          updated_at: string;
        };
        Insert: {
          available_balance?: number;
          created_at?: string;
          currency: string;
          customer_id: string;
          id?: string;
          merchant_id: string;
          total_credited?: number;
          total_debited?: number;
          updated_at?: string;
        };
        Update: {
          available_balance?: number;
          created_at?: string;
          currency?: string;
          customer_id?: string;
          id?: string;
          merchant_id?: string;
          total_credited?: number;
          total_debited?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_wallet_accounts_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_wallet_accounts_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_wallet_accounts_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_wallet_accounts_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_wallet_accounts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customer_wallet_accounts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_wallet_accounts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      customer_wallet_payment_accounts: {
        Row: {
          account_name: string;
          account_number: string;
          bank_name: string;
          bank_slug: string | null;
          consented_at: string;
          created_at: string;
          currency: string;
          customer_id: string;
          id: string;
          merchant_id: string;
          metadata: Json;
          provider: string;
          provider_account_id: string | null;
          provider_customer_code: string;
          provider_subaccount_code: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          account_name: string;
          account_number: string;
          bank_name: string;
          bank_slug?: string | null;
          consented_at: string;
          created_at?: string;
          currency?: string;
          customer_id: string;
          id?: string;
          merchant_id: string;
          metadata?: Json;
          provider?: string;
          provider_account_id?: string | null;
          provider_customer_code: string;
          provider_subaccount_code: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          account_name?: string;
          account_number?: string;
          bank_name?: string;
          bank_slug?: string | null;
          consented_at?: string;
          created_at?: string;
          currency?: string;
          customer_id?: string;
          id?: string;
          merchant_id?: string;
          metadata?: Json;
          provider?: string;
          provider_account_id?: string | null;
          provider_customer_code?: string;
          provider_subaccount_code?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_wallet_payment_accounts_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_wallet_payment_accounts_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_wallet_payment_accounts_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_wallet_payment_accounts_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_wallet_payment_accounts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customer_wallet_payment_accounts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_wallet_payment_accounts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      customer_wallet_transactions: {
        Row: {
          amount: number;
          balance_after: number;
          created_at: string | null;
          customer_id: string;
          description: string | null;
          id: string;
          merchant_id: string;
          metadata: Json | null;
          source_id: string | null;
          source_type: string | null;
          status: string | null;
          type: string;
          wallet_id: string;
        };
        Insert: {
          amount: number;
          balance_after: number;
          created_at?: string | null;
          customer_id: string;
          description?: string | null;
          id?: string;
          merchant_id: string;
          metadata?: Json | null;
          source_id?: string | null;
          source_type?: string | null;
          status?: string | null;
          type: string;
          wallet_id: string;
        };
        Update: {
          amount?: number;
          balance_after?: number;
          created_at?: string | null;
          customer_id?: string;
          description?: string | null;
          id?: string;
          merchant_id?: string;
          metadata?: Json | null;
          source_id?: string | null;
          source_type?: string | null;
          status?: string | null;
          type?: string;
          wallet_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_wallet_transactions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_wallet_transactions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_wallet_transactions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_wallet_transactions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_wallet_transactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customer_wallet_transactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_wallet_transactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customer_wallet_transactions_wallet_id_fkey';
            columns: ['wallet_id'];
            isOneToOne: false;
            referencedRelation: 'customer_wallets';
            referencedColumns: ['id'];
          },
        ];
      };
      customer_wallets: {
        Row: {
          available_balance: number | null;
          created_at: string | null;
          customer_id: string;
          id: string;
          merchant_id: string;
          total_earned: number | null;
          total_redeemed: number | null;
          updated_at: string | null;
        };
        Insert: {
          available_balance?: number | null;
          created_at?: string | null;
          customer_id: string;
          id?: string;
          merchant_id: string;
          total_earned?: number | null;
          total_redeemed?: number | null;
          updated_at?: string | null;
        };
        Update: {
          available_balance?: number | null;
          created_at?: string | null;
          customer_id?: string;
          id?: string;
          merchant_id?: string;
          total_earned?: number | null;
          total_redeemed?: number | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_wallets_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: true;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_wallets_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: true;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_wallets_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: true;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_wallets_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: true;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'customer_wallets_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customer_wallets_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_wallets_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      customers: {
        Row: {
          address: string | null;
          auth_provider: string | null;
          company_name: string | null;
          created_at: string | null;
          customer_type: string;
          date_of_birth: string | null;
          deleted_at: string | null;
          email: string | null;
          first_name: string | null;
          full_name: string | null;
          id: string;
          last_login_at: string | null;
          last_name: string | null;
          loyalty_points: number | null;
          merchant_id: string | null;
          phone: string | null;
          saved_addresses: Json | null;
          store_credit: number | null;
          total_orders: number | null;
          total_spent: number | null;
          updated_at: string | null;
          user_id: string | null;
          username: string | null;
          username_changed_at: string | null;
        };
        Insert: {
          address?: string | null;
          auth_provider?: string | null;
          company_name?: string | null;
          created_at?: string | null;
          customer_type?: string;
          date_of_birth?: string | null;
          deleted_at?: string | null;
          email?: string | null;
          first_name?: string | null;
          full_name?: string | null;
          id?: string;
          last_login_at?: string | null;
          last_name?: string | null;
          loyalty_points?: number | null;
          merchant_id?: string | null;
          phone?: string | null;
          saved_addresses?: Json | null;
          store_credit?: number | null;
          total_orders?: number | null;
          total_spent?: number | null;
          updated_at?: string | null;
          user_id?: string | null;
          username?: string | null;
          username_changed_at?: string | null;
        };
        Update: {
          address?: string | null;
          auth_provider?: string | null;
          company_name?: string | null;
          created_at?: string | null;
          customer_type?: string;
          date_of_birth?: string | null;
          deleted_at?: string | null;
          email?: string | null;
          first_name?: string | null;
          full_name?: string | null;
          id?: string;
          last_login_at?: string | null;
          last_name?: string | null;
          loyalty_points?: number | null;
          merchant_id?: string | null;
          phone?: string | null;
          saved_addresses?: Json | null;
          store_credit?: number | null;
          total_orders?: number | null;
          total_spent?: number | null;
          updated_at?: string | null;
          user_id?: string | null;
          username?: string | null;
          username_changed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'customers_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customers_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customers_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      dashboard_preferences: {
        Row: {
          created_at: string | null;
          id: string;
          layout_config: Json;
          merchant_id: string;
          updated_at: string | null;
          visible_cards: string[] | null;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          layout_config?: Json;
          merchant_id: string;
          updated_at?: string | null;
          visible_cards?: string[] | null;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          layout_config?: Json;
          merchant_id?: string;
          updated_at?: string | null;
          visible_cards?: string[] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'dashboard_preferences_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'dashboard_preferences_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'dashboard_preferences_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      discount_code_usage: {
        Row: {
          customer_email: string;
          discount_amount: number;
          discount_code_id: string;
          id: string;
          order_id: string | null;
          used_at: string | null;
        };
        Insert: {
          customer_email: string;
          discount_amount: number;
          discount_code_id: string;
          id?: string;
          order_id?: string | null;
          used_at?: string | null;
        };
        Update: {
          customer_email?: string;
          discount_amount?: number;
          discount_code_id?: string;
          id?: string;
          order_id?: string | null;
          used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'discount_code_usage_discount_code_id_fkey';
            columns: ['discount_code_id'];
            isOneToOne: false;
            referencedRelation: 'discount_codes';
            referencedColumns: ['id'];
          },
        ];
      };
      discount_codes: {
        Row: {
          applies_to: string;
          category_ids: Json | null;
          code: string;
          created_at: string | null;
          description: string | null;
          discount_type: string;
          discount_value: number;
          expires_at: string | null;
          id: string;
          is_active: boolean | null;
          maximum_discount_amount: number | null;
          merchant_id: string;
          minimum_purchase_amount: number | null;
          product_ids: Json | null;
          starts_at: string | null;
          updated_at: string | null;
          usage_count: number;
          usage_limit: number | null;
          usage_limit_per_customer: number | null;
        };
        Insert: {
          applies_to?: string;
          category_ids?: Json | null;
          code: string;
          created_at?: string | null;
          description?: string | null;
          discount_type: string;
          discount_value: number;
          expires_at?: string | null;
          id?: string;
          is_active?: boolean | null;
          maximum_discount_amount?: number | null;
          merchant_id: string;
          minimum_purchase_amount?: number | null;
          product_ids?: Json | null;
          starts_at?: string | null;
          updated_at?: string | null;
          usage_count?: number;
          usage_limit?: number | null;
          usage_limit_per_customer?: number | null;
        };
        Update: {
          applies_to?: string;
          category_ids?: Json | null;
          code?: string;
          created_at?: string | null;
          description?: string | null;
          discount_type?: string;
          discount_value?: number;
          expires_at?: string | null;
          id?: string;
          is_active?: boolean | null;
          maximum_discount_amount?: number | null;
          merchant_id?: string;
          minimum_purchase_amount?: number | null;
          product_ids?: Json | null;
          starts_at?: string | null;
          updated_at?: string | null;
          usage_count?: number;
          usage_limit?: number | null;
          usage_limit_per_customer?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'discount_codes_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'discount_codes_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'discount_codes_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      domain_event_failure_replays: {
        Row: {
          created_at: string;
          failure_id: string;
          id: number;
          queue_message_id: number;
          replay_number: number;
          replay_reason: string;
          replayed_by: string;
        };
        Insert: {
          created_at?: string;
          failure_id: string;
          id?: never;
          queue_message_id: number;
          replay_number: number;
          replay_reason: string;
          replayed_by: string;
        };
        Update: {
          created_at?: string;
          failure_id?: string;
          id?: never;
          queue_message_id?: number;
          replay_number?: number;
          replay_reason?: string;
          replayed_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'domain_event_failure_replays_failure_id_fkey';
            columns: ['failure_id'];
            isOneToOne: false;
            referencedRelation: 'domain_event_failures';
            referencedColumns: ['id'];
          },
        ];
      };
      domain_event_failures: {
        Row: {
          domain_event_id: string | null;
          event_name: string | null;
          failure_code: string;
          failure_message: string;
          first_failed_at: string;
          id: string;
          last_failed_at: string;
          merchant_id: string | null;
          original_envelope: Json;
          parser_version: number | null;
          queue_message_id: number;
          replay_count: number;
          replay_reason: string | null;
          replayed_at: string | null;
          replayed_by: string | null;
        };
        Insert: {
          domain_event_id?: string | null;
          event_name?: string | null;
          failure_code: string;
          failure_message: string;
          first_failed_at?: string;
          id?: string;
          last_failed_at?: string;
          merchant_id?: string | null;
          original_envelope: Json;
          parser_version?: number | null;
          queue_message_id: number;
          replay_count?: number;
          replay_reason?: string | null;
          replayed_at?: string | null;
          replayed_by?: string | null;
        };
        Update: {
          domain_event_id?: string | null;
          event_name?: string | null;
          failure_code?: string;
          failure_message?: string;
          first_failed_at?: string;
          id?: string;
          last_failed_at?: string;
          merchant_id?: string | null;
          original_envelope?: Json;
          parser_version?: number | null;
          queue_message_id?: number;
          replay_count?: number;
          replay_reason?: string | null;
          replayed_at?: string | null;
          replayed_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'domain_event_failures_domain_event_id_fkey';
            columns: ['domain_event_id'];
            isOneToOne: false;
            referencedRelation: 'domain_event_ledger';
            referencedColumns: ['domain_event_id'];
          },
        ];
      };
      domain_event_ledger: {
        Row: {
          created_at: string;
          domain_event_id: string;
          envelope: Json;
          event_name: string;
          external_event_id: string | null;
          idempotency_key: string;
          merchant_id: string | null;
          producer: string;
          queue_message_id: number | null;
          routed_at: string | null;
          schema_version: number;
          status: string;
          subject_id: string;
          subject_type: string;
          trust_level: string;
        };
        Insert: {
          created_at?: string;
          domain_event_id?: string;
          envelope: Json;
          event_name: string;
          external_event_id?: string | null;
          idempotency_key: string;
          merchant_id?: string | null;
          producer: string;
          queue_message_id?: number | null;
          routed_at?: string | null;
          schema_version?: number;
          status?: string;
          subject_id: string;
          subject_type: string;
          trust_level: string;
        };
        Update: {
          created_at?: string;
          domain_event_id?: string;
          envelope?: Json;
          event_name?: string;
          external_event_id?: string | null;
          idempotency_key?: string;
          merchant_id?: string | null;
          producer?: string;
          queue_message_id?: number | null;
          routed_at?: string | null;
          schema_version?: number;
          status?: string;
          subject_id?: string;
          subject_type?: string;
          trust_level?: string;
        };
        Relationships: [];
      };
      domain_event_producer_config: {
        Row: {
          enabled: boolean;
          producer_key: string;
          shadow_only: boolean;
          updated_at: string;
        };
        Insert: {
          enabled?: boolean;
          producer_key: string;
          shadow_only?: boolean;
          updated_at?: string;
        };
        Update: {
          enabled?: boolean;
          producer_key?: string;
          shadow_only?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      domains: {
        Row: {
          created_at: string | null;
          domain: string;
          domain_type: string;
          id: string;
          is_primary: boolean | null;
          merchant_id: string;
          nameservers: Json | null;
          purchase_info: Json | null;
          ssl_status: string | null;
          status: string;
          tld: string | null;
          updated_at: string | null;
          verification_token: string | null;
          verification_token_expires_at: string | null;
          verified_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          domain: string;
          domain_type: string;
          id?: string;
          is_primary?: boolean | null;
          merchant_id: string;
          nameservers?: Json | null;
          purchase_info?: Json | null;
          ssl_status?: string | null;
          status?: string;
          tld?: string | null;
          updated_at?: string | null;
          verification_token?: string | null;
          verification_token_expires_at?: string | null;
          verified_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          domain?: string;
          domain_type?: string;
          id?: string;
          is_primary?: boolean | null;
          merchant_id?: string;
          nameservers?: Json | null;
          purchase_info?: Json | null;
          ssl_status?: string | null;
          status?: string;
          tld?: string | null;
          updated_at?: string | null;
          verification_token?: string | null;
          verification_token_expires_at?: string | null;
          verified_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'domains_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'domains_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'domains_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      email_send_attempts: {
        Row: {
          attempt_count: number;
          created_at: string;
          customer_id: string | null;
          delivery_channel: string;
          email_type: string;
          from_address: string;
          from_name: string | null;
          id: string;
          merchant_id: string | null;
          metadata: Json;
          order_id: string | null;
          provider: string;
          provider_error_code: string | null;
          provider_error_details: Json | null;
          provider_error_message: string | null;
          provider_message_id: string | null;
          recipient_email: string;
          recipient_name: string | null;
          reply_to: string | null;
          status: string;
          subject: string | null;
          template_key: string | null;
          transport_type: string;
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          created_at?: string;
          customer_id?: string | null;
          delivery_channel?: string;
          email_type: string;
          from_address: string;
          from_name?: string | null;
          id?: string;
          merchant_id?: string | null;
          metadata?: Json;
          order_id?: string | null;
          provider?: string;
          provider_error_code?: string | null;
          provider_error_details?: Json | null;
          provider_error_message?: string | null;
          provider_message_id?: string | null;
          recipient_email: string;
          recipient_name?: string | null;
          reply_to?: string | null;
          status: string;
          subject?: string | null;
          template_key?: string | null;
          transport_type: string;
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          created_at?: string;
          customer_id?: string | null;
          delivery_channel?: string;
          email_type?: string;
          from_address?: string;
          from_name?: string | null;
          id?: string;
          merchant_id?: string | null;
          metadata?: Json;
          order_id?: string | null;
          provider?: string;
          provider_error_code?: string | null;
          provider_error_details?: Json | null;
          provider_error_message?: string | null;
          provider_message_id?: string | null;
          recipient_email?: string;
          recipient_name?: string | null;
          reply_to?: string | null;
          status?: string;
          subject?: string | null;
          template_key?: string | null;
          transport_type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'email_send_attempts_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'email_send_attempts_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'email_send_attempts_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'email_send_attempts_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'email_send_attempts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'email_send_attempts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'email_send_attempts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'email_send_attempts_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      event_deliveries: {
        Row: {
          attempts: number;
          available_at: string;
          claim_token: string | null;
          claimed_at: string | null;
          claimed_by: string | null;
          created_at: string;
          dead_lettered_at: string | null;
          delivered_at: string | null;
          destination: string;
          domain_event_id: string;
          id: string;
          last_error_code: string | null;
          last_error_message: string | null;
          last_http_status: number | null;
          last_replay_reason: string | null;
          last_replayed_at: string | null;
          last_replayed_by: string | null;
          payload: Json;
          provider_response_id: string | null;
          replay_attempts: number;
          replay_count: number;
          shadowed_at: string | null;
          skipped_at: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          available_at?: string;
          claim_token?: string | null;
          claimed_at?: string | null;
          claimed_by?: string | null;
          created_at?: string;
          dead_lettered_at?: string | null;
          delivered_at?: string | null;
          destination: string;
          domain_event_id: string;
          id?: string;
          last_error_code?: string | null;
          last_error_message?: string | null;
          last_http_status?: number | null;
          last_replay_reason?: string | null;
          last_replayed_at?: string | null;
          last_replayed_by?: string | null;
          payload: Json;
          provider_response_id?: string | null;
          replay_attempts?: number;
          replay_count?: number;
          shadowed_at?: string | null;
          skipped_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          available_at?: string;
          claim_token?: string | null;
          claimed_at?: string | null;
          claimed_by?: string | null;
          created_at?: string;
          dead_lettered_at?: string | null;
          delivered_at?: string | null;
          destination?: string;
          domain_event_id?: string;
          id?: string;
          last_error_code?: string | null;
          last_error_message?: string | null;
          last_http_status?: number | null;
          last_replay_reason?: string | null;
          last_replayed_at?: string | null;
          last_replayed_by?: string | null;
          payload?: Json;
          provider_response_id?: string | null;
          replay_attempts?: number;
          replay_count?: number;
          shadowed_at?: string | null;
          skipped_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'event_deliveries_domain_event_id_fkey';
            columns: ['domain_event_id'];
            isOneToOne: false;
            referencedRelation: 'domain_event_ledger';
            referencedColumns: ['domain_event_id'];
          },
        ];
      };
      event_delivery_attempts: {
        Row: {
          attempt_number: number;
          created_at: string;
          delivery_id: string;
          duration_ms: number;
          error_code: string | null;
          error_message: string | null;
          finished_at: string;
          http_status: number | null;
          id: number;
          outcome: string;
          started_at: string;
          worker_id: string;
        };
        Insert: {
          attempt_number: number;
          created_at?: string;
          delivery_id: string;
          duration_ms: number;
          error_code?: string | null;
          error_message?: string | null;
          finished_at?: string;
          http_status?: number | null;
          id?: never;
          outcome: string;
          started_at: string;
          worker_id: string;
        };
        Update: {
          attempt_number?: number;
          created_at?: string;
          delivery_id?: string;
          duration_ms?: number;
          error_code?: string | null;
          error_message?: string | null;
          finished_at?: string;
          http_status?: number | null;
          id?: never;
          outcome?: string;
          started_at?: string;
          worker_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'event_delivery_attempts_delivery_id_fkey';
            columns: ['delivery_id'];
            isOneToOne: false;
            referencedRelation: 'event_deliveries';
            referencedColumns: ['id'];
          },
        ];
      };
      event_delivery_replays: {
        Row: {
          created_at: string;
          delivery_id: string;
          id: number;
          replay_number: number;
          replay_reason: string;
          replayed_by: string;
        };
        Insert: {
          created_at?: string;
          delivery_id: string;
          id?: never;
          replay_number: number;
          replay_reason: string;
          replayed_by: string;
        };
        Update: {
          created_at?: string;
          delivery_id?: string;
          id?: never;
          replay_number?: number;
          replay_reason?: string;
          replayed_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'event_delivery_replays_delivery_id_fkey';
            columns: ['delivery_id'];
            isOneToOne: false;
            referencedRelation: 'event_deliveries';
            referencedColumns: ['id'];
          },
        ];
      };
      event_pipeline_worker_heartbeats: {
        Row: {
          last_error_at: string | null;
          last_error_code: string | null;
          last_started_at: string | null;
          last_succeeded_at: string | null;
          processed_count: number;
          updated_at: string;
          worker_id: string;
          worker_name: string;
        };
        Insert: {
          last_error_at?: string | null;
          last_error_code?: string | null;
          last_started_at?: string | null;
          last_succeeded_at?: string | null;
          processed_count?: number;
          updated_at?: string;
          worker_id: string;
          worker_name: string;
        };
        Update: {
          last_error_at?: string | null;
          last_error_code?: string | null;
          last_started_at?: string | null;
          last_succeeded_at?: string | null;
          processed_count?: number;
          updated_at?: string;
          worker_id?: string;
          worker_name?: string;
        };
        Relationships: [];
      };
      expenses: {
        Row: {
          amount: number;
          branch_id: string | null;
          category: string;
          created_at: string;
          created_by_user_id: string | null;
          date: string;
          description: string | null;
          group_id: string | null;
          id: string;
          merchant_id: string;
          payment_method: string | null;
          receipt_storage_path: string | null;
          receipt_url: string | null;
          reference: string | null;
          updated_at: string;
          updated_by_user_id: string | null;
          vendor_name: string | null;
        };
        Insert: {
          amount?: number;
          branch_id?: string | null;
          category: string;
          created_at?: string;
          created_by_user_id?: string | null;
          date?: string;
          description?: string | null;
          group_id?: string | null;
          id?: string;
          merchant_id: string;
          payment_method?: string | null;
          receipt_storage_path?: string | null;
          receipt_url?: string | null;
          reference?: string | null;
          updated_at?: string;
          updated_by_user_id?: string | null;
          vendor_name?: string | null;
        };
        Update: {
          amount?: number;
          branch_id?: string | null;
          category?: string;
          created_at?: string;
          created_by_user_id?: string | null;
          date?: string;
          description?: string | null;
          group_id?: string | null;
          id?: string;
          merchant_id?: string;
          payment_method?: string | null;
          receipt_storage_path?: string | null;
          receipt_url?: string | null;
          reference?: string | null;
          updated_at?: string;
          updated_by_user_id?: string | null;
          vendor_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'expenses_branch_id_fkey';
            columns: ['branch_id'];
            isOneToOne: false;
            referencedRelation: 'branches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'expenses_created_by_user_id_fkey';
            columns: ['created_by_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'expenses_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'expense_groups';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'expenses_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'expenses_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'expenses_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'expenses_updated_by_user_id_fkey';
            columns: ['updated_by_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      expense_groups: {
        Row: {
          archived_at: string | null;
          created_at: string;
          id: string;
          merchant_id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          merchant_id: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          merchant_id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'expense_groups_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'expense_groups_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'expense_groups_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      feedback: {
        Row: {
          app_version: string | null;
          categories: string[] | null;
          created_at: string | null;
          id: string;
          merchant_id: string | null;
          message: string | null;
          platform: string | null;
          rating: number;
          user_id: string | null;
        };
        Insert: {
          app_version?: string | null;
          categories?: string[] | null;
          created_at?: string | null;
          id?: string;
          merchant_id?: string | null;
          message?: string | null;
          platform?: string | null;
          rating: number;
          user_id?: string | null;
        };
        Update: {
          app_version?: string | null;
          categories?: string[] | null;
          created_at?: string | null;
          id?: string;
          merchant_id?: string | null;
          message?: string | null;
          platform?: string | null;
          rating?: number;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'feedback_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'feedback_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      form_submissions: {
        Row: {
          created_at: string | null;
          form_data: Json;
          form_name: string;
          id: string;
          ip_address: string | null;
          merchant_id: string;
          status: string | null;
          submitted_at: string | null;
          updated_at: string | null;
          user_agent: string | null;
        };
        Insert: {
          created_at?: string | null;
          form_data: Json;
          form_name: string;
          id?: string;
          ip_address?: string | null;
          merchant_id: string;
          status?: string | null;
          submitted_at?: string | null;
          updated_at?: string | null;
          user_agent?: string | null;
        };
        Update: {
          created_at?: string | null;
          form_data?: Json;
          form_name?: string;
          id?: string;
          ip_address?: string | null;
          merchant_id?: string;
          status?: string | null;
          submitted_at?: string | null;
          updated_at?: string | null;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'form_submissions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'form_submissions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'form_submissions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      imei_lookups: {
        Row: {
          amount_ngn: number;
          cached_response: Json | null;
          cached_status: number | null;
          cost_usd: number | null;
          created_at: string;
          customer_id: string;
          device_category: string | null;
          feedback_token_hash: string | null;
          id: string;
          idempotency_key: string;
          identifier_ciphertext: string | null;
          imei_hash: string;
          merchant_id: string;
          next_poll_at: string | null;
          provider: string | null;
          provider_attempt_started_at: string | null;
          provider_order_id: string | null;
          provider_status: string | null;
          reconcile_attempts: number;
          reconcile_lease_token: string | null;
          reconcile_lease_until: string | null;
          reference_id: string | null;
          response_hash: string | null;
          sickw_status: string | null;
          status: string;
          tier: string;
          updated_at: string;
        };
        Insert: {
          amount_ngn: number;
          cached_response?: Json | null;
          cached_status?: number | null;
          cost_usd?: number | null;
          created_at?: string;
          customer_id: string;
          device_category?: string | null;
          feedback_token_hash?: string | null;
          id?: string;
          idempotency_key: string;
          identifier_ciphertext?: string | null;
          imei_hash: string;
          merchant_id: string;
          next_poll_at?: string | null;
          provider?: string | null;
          provider_attempt_started_at?: string | null;
          provider_order_id?: string | null;
          provider_status?: string | null;
          reconcile_attempts?: number;
          reconcile_lease_token?: string | null;
          reconcile_lease_until?: string | null;
          reference_id?: string | null;
          response_hash?: string | null;
          sickw_status?: string | null;
          status: string;
          tier: string;
          updated_at?: string;
        };
        Update: {
          amount_ngn?: number;
          cached_response?: Json | null;
          cached_status?: number | null;
          cost_usd?: number | null;
          created_at?: string;
          customer_id?: string;
          device_category?: string | null;
          feedback_token_hash?: string | null;
          id?: string;
          idempotency_key?: string;
          identifier_ciphertext?: string | null;
          imei_hash?: string;
          merchant_id?: string;
          next_poll_at?: string | null;
          provider?: string | null;
          provider_attempt_started_at?: string | null;
          provider_order_id?: string | null;
          provider_status?: string | null;
          reconcile_attempts?: number;
          reconcile_lease_token?: string | null;
          reconcile_lease_until?: string | null;
          reference_id?: string | null;
          response_hash?: string | null;
          sickw_status?: string | null;
          status?: string;
          tier?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'imei_lookups_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'imei_lookups_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'imei_lookups_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'imei_lookups_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'imei_lookups_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'imei_lookups_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'imei_lookups_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      imei_provider_products: {
        Row: {
          active: boolean;
          category_id: string | null;
          category_name: string | null;
          created_at: string;
          currency: string;
          input_fields: Json;
          name: string;
          order_field_name: string | null;
          price_usd: number | null;
          product_id: string;
          provider: string;
          raw_product: Json;
          synced_at: string;
          turnaround: string | null;
          type: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          category_id?: string | null;
          category_name?: string | null;
          created_at?: string;
          currency?: string;
          input_fields?: Json;
          name: string;
          order_field_name?: string | null;
          price_usd?: number | null;
          product_id: string;
          provider: string;
          raw_product: Json;
          synced_at?: string;
          turnaround?: string | null;
          type: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          category_id?: string | null;
          category_name?: string | null;
          created_at?: string;
          currency?: string;
          input_fields?: Json;
          name?: string;
          order_field_name?: string | null;
          price_usd?: number | null;
          product_id?: string;
          provider?: string;
          raw_product?: Json;
          synced_at?: string;
          turnaround?: string | null;
          type?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      import_job_rows: {
        Row: {
          created_at: string;
          id: string;
          import_job_id: string;
          merchant_id: string;
          meta: Json;
          normalized_payload: Json | null;
          row_number: number;
          row_status: string;
          source_external_id: string | null;
          source_payload: Json;
          updated_at: string;
          validation_errors: Json;
        };
        Insert: {
          created_at?: string;
          id?: string;
          import_job_id: string;
          merchant_id: string;
          meta?: Json;
          normalized_payload?: Json | null;
          row_number: number;
          row_status: string;
          source_external_id?: string | null;
          source_payload: Json;
          updated_at?: string;
          validation_errors?: Json;
        };
        Update: {
          created_at?: string;
          id?: string;
          import_job_id?: string;
          merchant_id?: string;
          meta?: Json;
          normalized_payload?: Json | null;
          row_number?: number;
          row_status?: string;
          source_external_id?: string | null;
          source_payload?: Json;
          updated_at?: string;
          validation_errors?: Json;
        };
        Relationships: [
          {
            foreignKeyName: 'import_job_rows_import_job_id_fkey';
            columns: ['import_job_id'];
            isOneToOne: false;
            referencedRelation: 'import_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'import_job_rows_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'import_job_rows_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'import_job_rows_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      import_jobs: {
        Row: {
          client_upload_id: string | null;
          committed_at: string | null;
          completed_at: string | null;
          content_type: string | null;
          created_at: string;
          created_by: string;
          entity_type: string;
          error: string | null;
          error_details: Json | null;
          file_size_bytes: number | null;
          id: string;
          merchant_id: string;
          notified_at: string | null;
          original_filename: string;
          processed_rows: number;
          source_platform: string;
          started_at: string | null;
          status: string;
          storage_path: string;
          summary: Json;
          total_rows: number;
          updated_at: string;
        };
        Insert: {
          client_upload_id?: string | null;
          committed_at?: string | null;
          completed_at?: string | null;
          content_type?: string | null;
          created_at?: string;
          created_by: string;
          entity_type: string;
          error?: string | null;
          error_details?: Json | null;
          file_size_bytes?: number | null;
          id?: string;
          merchant_id: string;
          notified_at?: string | null;
          original_filename: string;
          processed_rows?: number;
          source_platform: string;
          started_at?: string | null;
          status: string;
          storage_path: string;
          summary?: Json;
          total_rows?: number;
          updated_at?: string;
        };
        Update: {
          client_upload_id?: string | null;
          committed_at?: string | null;
          completed_at?: string | null;
          content_type?: string | null;
          created_at?: string;
          created_by?: string;
          entity_type?: string;
          error?: string | null;
          error_details?: Json | null;
          file_size_bytes?: number | null;
          id?: string;
          merchant_id?: string;
          notified_at?: string | null;
          original_filename?: string;
          processed_rows?: number;
          source_platform?: string;
          started_at?: string | null;
          status?: string;
          storage_path?: string;
          summary?: Json;
          total_rows?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'import_jobs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'import_jobs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'import_jobs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      inventory_alerts: {
        Row: {
          acknowledged_at: string | null;
          acknowledged_by: string | null;
          alert_type: string;
          created_at: string | null;
          current_stock: number;
          days_until_stockout: number | null;
          id: string;
          merchant_id: string;
          notification_attempts: number;
          notification_sent: boolean | null;
          notification_sent_at: string | null;
          predicted_stockout_date: string | null;
          product_id: string;
          resolved_at: string | null;
          status: string | null;
          threshold: number | null;
          updated_at: string | null;
          variant_id: string | null;
        };
        Insert: {
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          alert_type: string;
          created_at?: string | null;
          current_stock: number;
          days_until_stockout?: number | null;
          id?: string;
          merchant_id: string;
          notification_attempts?: number;
          notification_sent?: boolean | null;
          notification_sent_at?: string | null;
          predicted_stockout_date?: string | null;
          product_id: string;
          resolved_at?: string | null;
          status?: string | null;
          threshold?: number | null;
          updated_at?: string | null;
          variant_id?: string | null;
        };
        Update: {
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          alert_type?: string;
          created_at?: string | null;
          current_stock?: number;
          days_until_stockout?: number | null;
          id?: string;
          merchant_id?: string;
          notification_attempts?: number;
          notification_sent?: boolean | null;
          notification_sent_at?: string | null;
          predicted_stockout_date?: string | null;
          product_id?: string;
          resolved_at?: string | null;
          status?: string | null;
          threshold?: number | null;
          updated_at?: string | null;
          variant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'inventory_alerts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'inventory_alerts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'inventory_alerts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'inventory_alerts_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'low_stock_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'inventory_alerts_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'inventory_alerts_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'inventory_alerts_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'secure_product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'inventory_alerts_variant_id_fkey';
            columns: ['variant_id'];
            isOneToOne: false;
            referencedRelation: 'product_variants';
            referencedColumns: ['id'];
          },
        ];
      };
      inventory_snapshots: {
        Row: {
          available_quantity: number | null;
          avg_daily_sales: number | null;
          created_at: string | null;
          days_of_stock_remaining: number | null;
          id: string;
          merchant_id: string;
          product_id: string;
          reserved_quantity: number | null;
          snapshot_date: string;
          stock_quantity: number;
          units_sold_30d: number | null;
          units_sold_7d: number | null;
          units_sold_today: number | null;
          variant_id: string | null;
        };
        Insert: {
          available_quantity?: number | null;
          avg_daily_sales?: number | null;
          created_at?: string | null;
          days_of_stock_remaining?: number | null;
          id?: string;
          merchant_id: string;
          product_id: string;
          reserved_quantity?: number | null;
          snapshot_date?: string;
          stock_quantity: number;
          units_sold_30d?: number | null;
          units_sold_7d?: number | null;
          units_sold_today?: number | null;
          variant_id?: string | null;
        };
        Update: {
          available_quantity?: number | null;
          avg_daily_sales?: number | null;
          created_at?: string | null;
          days_of_stock_remaining?: number | null;
          id?: string;
          merchant_id?: string;
          product_id?: string;
          reserved_quantity?: number | null;
          snapshot_date?: string;
          stock_quantity?: number;
          units_sold_30d?: number | null;
          units_sold_7d?: number | null;
          units_sold_today?: number | null;
          variant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'inventory_snapshots_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'inventory_snapshots_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'inventory_snapshots_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'inventory_snapshots_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'low_stock_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'inventory_snapshots_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'inventory_snapshots_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'inventory_snapshots_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'secure_product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'inventory_snapshots_variant_id_fkey';
            columns: ['variant_id'];
            isOneToOne: false;
            referencedRelation: 'product_variants';
            referencedColumns: ['id'];
          },
        ];
      };
      jumia_orders: {
        Row: {
          baci_order_id: string | null;
          created_at_jumia: string | null;
          currency: string;
          customer_name: string | null;
          customer_phone: string | null;
          id: string;
          items: Json;
          jumia_order_id: string;
          jumia_order_number: string | null;
          jumia_shop_id: string;
          merchant_id: string;
          notification_sent: boolean;
          shipping_address: Json | null;
          status: string;
          synced_at: string;
          total_amount: number | null;
          updated_at: string;
        };
        Insert: {
          baci_order_id?: string | null;
          created_at_jumia?: string | null;
          currency?: string;
          customer_name?: string | null;
          customer_phone?: string | null;
          id?: string;
          items?: Json;
          jumia_order_id: string;
          jumia_order_number?: string | null;
          jumia_shop_id: string;
          merchant_id: string;
          notification_sent?: boolean;
          shipping_address?: Json | null;
          status: string;
          synced_at?: string;
          total_amount?: number | null;
          updated_at?: string;
        };
        Update: {
          baci_order_id?: string | null;
          created_at_jumia?: string | null;
          currency?: string;
          customer_name?: string | null;
          customer_phone?: string | null;
          id?: string;
          items?: Json;
          jumia_order_id?: string;
          jumia_order_number?: string | null;
          jumia_shop_id?: string;
          merchant_id?: string;
          notification_sent?: boolean;
          shipping_address?: Json | null;
          status?: string;
          synced_at?: string;
          total_amount?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'jumia_orders_baci_order_id_fkey';
            columns: ['baci_order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'jumia_orders_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'jumia_orders_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'jumia_orders_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      jumia_product_mappings: {
        Row: {
          baci_stock_at_last_sync: number | null;
          created_at: string;
          id: string;
          is_active: boolean | null;
          jumia_price: number | null;
          jumia_product_id: string | null;
          jumia_sale_end: string | null;
          jumia_sale_price: number | null;
          jumia_sale_start: string | null;
          jumia_seller_sku: string | null;
          jumia_shop_id: string;
          jumia_sku: string;
          last_feed_id: string | null;
          last_stock_synced_at: string | null;
          last_synced_at: string | null;
          merchant_id: string;
          product_id: string;
          sync_error: string | null;
          sync_inventory: boolean | null;
          sync_price: boolean | null;
          sync_status: string;
          updated_at: string | null;
          variant_id: string | null;
        };
        Insert: {
          baci_stock_at_last_sync?: number | null;
          created_at?: string;
          id?: string;
          is_active?: boolean | null;
          jumia_price?: number | null;
          jumia_product_id?: string | null;
          jumia_sale_end?: string | null;
          jumia_sale_price?: number | null;
          jumia_sale_start?: string | null;
          jumia_seller_sku?: string | null;
          jumia_shop_id: string;
          jumia_sku: string;
          last_feed_id?: string | null;
          last_stock_synced_at?: string | null;
          last_synced_at?: string | null;
          merchant_id: string;
          product_id: string;
          sync_error?: string | null;
          sync_inventory?: boolean | null;
          sync_price?: boolean | null;
          sync_status?: string;
          updated_at?: string | null;
          variant_id?: string | null;
        };
        Update: {
          baci_stock_at_last_sync?: number | null;
          created_at?: string;
          id?: string;
          is_active?: boolean | null;
          jumia_price?: number | null;
          jumia_product_id?: string | null;
          jumia_sale_end?: string | null;
          jumia_sale_price?: number | null;
          jumia_sale_start?: string | null;
          jumia_seller_sku?: string | null;
          jumia_shop_id?: string;
          jumia_sku?: string;
          last_feed_id?: string | null;
          last_stock_synced_at?: string | null;
          last_synced_at?: string | null;
          merchant_id?: string;
          product_id?: string;
          sync_error?: string | null;
          sync_inventory?: boolean | null;
          sync_price?: boolean | null;
          sync_status?: string;
          updated_at?: string | null;
          variant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'jumia_product_mappings_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'jumia_product_mappings_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'jumia_product_mappings_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'jumia_product_mappings_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'low_stock_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'jumia_product_mappings_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'jumia_product_mappings_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'jumia_product_mappings_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'secure_product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'jumia_product_mappings_variant_id_fkey';
            columns: ['variant_id'];
            isOneToOne: false;
            referencedRelation: 'product_variants';
            referencedColumns: ['id'];
          },
        ];
      };
      leaderboard_refresh_log: {
        Row: {
          created_at: string;
          details: Json;
          event_id: string;
          id: string;
          refresh_reason: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          details?: Json;
          event_id: string;
          id?: string;
          refresh_reason: string;
          status?: string;
        };
        Update: {
          created_at?: string;
          details?: Json;
          event_id?: string;
          id?: string;
          refresh_reason?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'leaderboard_refresh_log_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_events';
            referencedColumns: ['id'];
          },
        ];
      };
      loyalty_airtime_rewards: {
        Row: {
          airtime_amount: number;
          created_at: string | null;
          description: string | null;
          id: string;
          is_active: boolean | null;
          max_redemptions_per_customer: number | null;
          max_total_redemptions: number | null;
          merchant_id: string;
          name: string;
          network_provider: string | null;
          points_required: number;
          total_redemptions: number | null;
          updated_at: string | null;
        };
        Insert: {
          airtime_amount: number;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          is_active?: boolean | null;
          max_redemptions_per_customer?: number | null;
          max_total_redemptions?: number | null;
          merchant_id: string;
          name: string;
          network_provider?: string | null;
          points_required: number;
          total_redemptions?: number | null;
          updated_at?: string | null;
        };
        Update: {
          airtime_amount?: number;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          is_active?: boolean | null;
          max_redemptions_per_customer?: number | null;
          max_total_redemptions?: number | null;
          merchant_id?: string;
          name?: string;
          network_provider?: string | null;
          points_required?: number;
          total_redemptions?: number | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'loyalty_airtime_rewards_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'loyalty_airtime_rewards_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'loyalty_airtime_rewards_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      loyalty_rewards: {
        Row: {
          created_at: string | null;
          description: string | null;
          enabled: boolean | null;
          end_date: string | null;
          id: string;
          image_url: string | null;
          merchant_id: string;
          minimum_order_amount: number | null;
          name: string;
          points_cost: number;
          reward_product_id: string | null;
          reward_type: string;
          reward_value: number | null;
          start_date: string | null;
          stock_quantity: number | null;
          updated_at: string | null;
          usage_limit_per_customer: number | null;
        };
        Insert: {
          created_at?: string | null;
          description?: string | null;
          enabled?: boolean | null;
          end_date?: string | null;
          id?: string;
          image_url?: string | null;
          merchant_id: string;
          minimum_order_amount?: number | null;
          name: string;
          points_cost: number;
          reward_product_id?: string | null;
          reward_type: string;
          reward_value?: number | null;
          start_date?: string | null;
          stock_quantity?: number | null;
          updated_at?: string | null;
          usage_limit_per_customer?: number | null;
        };
        Update: {
          created_at?: string | null;
          description?: string | null;
          enabled?: boolean | null;
          end_date?: string | null;
          id?: string;
          image_url?: string | null;
          merchant_id?: string;
          minimum_order_amount?: number | null;
          name?: string;
          points_cost?: number;
          reward_product_id?: string | null;
          reward_type?: string;
          reward_value?: number | null;
          start_date?: string | null;
          stock_quantity?: number | null;
          updated_at?: string | null;
          usage_limit_per_customer?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'loyalty_rewards_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'loyalty_rewards_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'loyalty_rewards_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      loyalty_settings: {
        Row: {
          birthday_bonus_points: number | null;
          created_at: string | null;
          enabled: boolean | null;
          id: string;
          maximum_redemption_percentage: number | null;
          merchant_id: string;
          minimum_redemption_points: number | null;
          points_currency_unit: number | null;
          points_expiry_days: number | null;
          points_per_currency: number | null;
          points_to_currency_ratio: number | null;
          program_name: string | null;
          referral_bonus_points: number | null;
          review_bonus_points: number | null;
          signup_bonus_points: number | null;
          tiers: Json | null;
          updated_at: string | null;
        };
        Insert: {
          birthday_bonus_points?: number | null;
          created_at?: string | null;
          enabled?: boolean | null;
          id?: string;
          maximum_redemption_percentage?: number | null;
          merchant_id: string;
          minimum_redemption_points?: number | null;
          points_currency_unit?: number | null;
          points_expiry_days?: number | null;
          points_per_currency?: number | null;
          points_to_currency_ratio?: number | null;
          program_name?: string | null;
          referral_bonus_points?: number | null;
          review_bonus_points?: number | null;
          signup_bonus_points?: number | null;
          tiers?: Json | null;
          updated_at?: string | null;
        };
        Update: {
          birthday_bonus_points?: number | null;
          created_at?: string | null;
          enabled?: boolean | null;
          id?: string;
          maximum_redemption_percentage?: number | null;
          merchant_id?: string;
          minimum_redemption_points?: number | null;
          points_currency_unit?: number | null;
          points_expiry_days?: number | null;
          points_per_currency?: number | null;
          points_to_currency_ratio?: number | null;
          program_name?: string | null;
          referral_bonus_points?: number | null;
          review_bonus_points?: number | null;
          signup_bonus_points?: number | null;
          tiers?: Json | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'loyalty_settings_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'loyalty_settings_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'loyalty_settings_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      manual_payment_side_effects: {
        Row: {
          attempts: number;
          claim_token: string;
          claimed_at: string;
          claimed_by: string;
          completed_at: string | null;
          dedupe_id: string;
          error: string | null;
          merchant_id: string;
          order_id: string;
          status: string;
          step: string;
          transaction_id: string;
        };
        Insert: {
          attempts?: number;
          claim_token: string;
          claimed_at?: string;
          claimed_by: string;
          completed_at?: string | null;
          dedupe_id: string;
          error?: string | null;
          merchant_id: string;
          order_id: string;
          status: string;
          step: string;
          transaction_id: string;
        };
        Update: {
          attempts?: number;
          claim_token?: string;
          claimed_at?: string;
          claimed_by?: string;
          completed_at?: string | null;
          dedupe_id?: string;
          error?: string | null;
          merchant_id?: string;
          order_id?: string;
          status?: string;
          step?: string;
          transaction_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'manual_payment_side_effects_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'manual_payment_side_effects_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'manual_payment_side_effects_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'manual_payment_side_effects_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'manual_payment_side_effects_transaction_id_fkey';
            columns: ['transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
        ];
      };
      marketplace_integrations: {
        Row: {
          access_token: string | null;
          country_code: string | null;
          created_at: string;
          id: string;
          is_active: boolean;
          last_sync_at: string | null;
          merchant_id: string;
          platform: string;
          refresh_token: string | null;
          shop_id: string | null;
          shop_name: string | null;
          sync_config: Json;
          sync_error: string | null;
          token_expires_at: string | null;
          updated_at: string;
        };
        Insert: {
          access_token?: string | null;
          country_code?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          last_sync_at?: string | null;
          merchant_id: string;
          platform: string;
          refresh_token?: string | null;
          shop_id?: string | null;
          shop_name?: string | null;
          sync_config?: Json;
          sync_error?: string | null;
          token_expires_at?: string | null;
          updated_at?: string;
        };
        Update: {
          access_token?: string | null;
          country_code?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          last_sync_at?: string | null;
          merchant_id?: string;
          platform?: string;
          refresh_token?: string | null;
          shop_id?: string | null;
          shop_name?: string | null;
          sync_config?: Json;
          sync_error?: string | null;
          token_expires_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'marketplace_integrations_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'marketplace_integrations_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'marketplace_integrations_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      merchant_agents: {
        Row: {
          content_pillars: Json | null;
          created_at: string | null;
          email_recipients: string[] | null;
          id: string;
          inventory_brands: string[] | null;
          keywords: string[] | null;
          last_run_at: string | null;
          merchant_id: string;
          rss_urls: string[] | null;
          status: string | null;
          tone_voice: string | null;
          updated_at: string | null;
        };
        Insert: {
          content_pillars?: Json | null;
          created_at?: string | null;
          email_recipients?: string[] | null;
          id?: string;
          inventory_brands?: string[] | null;
          keywords?: string[] | null;
          last_run_at?: string | null;
          merchant_id: string;
          rss_urls?: string[] | null;
          status?: string | null;
          tone_voice?: string | null;
          updated_at?: string | null;
        };
        Update: {
          content_pillars?: Json | null;
          created_at?: string | null;
          email_recipients?: string[] | null;
          id?: string;
          inventory_brands?: string[] | null;
          keywords?: string[] | null;
          last_run_at?: string | null;
          merchant_id?: string;
          rss_urls?: string[] | null;
          status?: string | null;
          tone_voice?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'merchant_agents_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'merchant_agents_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'merchant_agents_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      merchant_auth_readiness: {
        Row: {
          acknowledged_code_set_id: string | null;
          authenticator_count: number;
          device_bound_verified_at: string | null;
          passkey_ready_at: string | null;
          password_demoted_at: string | null;
          recovery_codes_acknowledged_at: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          acknowledged_code_set_id?: string | null;
          authenticator_count?: number;
          device_bound_verified_at?: string | null;
          passkey_ready_at?: string | null;
          password_demoted_at?: string | null;
          recovery_codes_acknowledged_at?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          acknowledged_code_set_id?: string | null;
          authenticator_count?: number;
          device_bound_verified_at?: string | null;
          passkey_ready_at?: string | null;
          password_demoted_at?: string | null;
          recovery_codes_acknowledged_at?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      merchant_auth_recovery_attempts: {
        Row: {
          code_set_id: string | null;
          created_at: string;
          id: string;
          ip_hash: string | null;
          succeeded: boolean;
          user_id: string;
        };
        Insert: {
          code_set_id?: string | null;
          created_at?: string;
          id?: string;
          ip_hash?: string | null;
          succeeded: boolean;
          user_id: string;
        };
        Update: {
          code_set_id?: string | null;
          created_at?: string;
          id?: string;
          ip_hash?: string | null;
          succeeded?: boolean;
          user_id?: string;
        };
        Relationships: [];
      };
      merchant_auth_recovery_codes: {
        Row: {
          code_hash: string;
          code_set_id: string;
          created_at: string;
          id: string;
          revoked_at: string | null;
          used_at: string | null;
          user_id: string;
        };
        Insert: {
          code_hash: string;
          code_set_id: string;
          created_at?: string;
          id?: string;
          revoked_at?: string | null;
          used_at?: string | null;
          user_id: string;
        };
        Update: {
          code_hash?: string;
          code_set_id?: string;
          created_at?: string;
          id?: string;
          revoked_at?: string | null;
          used_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      merchant_balances: {
        Row: {
          available_balance: number | null;
          created_at: string | null;
          currency: string;
          id: string;
          merchant_id: string;
          pending_balance: number | null;
          total_earned: number | null;
          total_withdrawn: number | null;
          updated_at: string | null;
        };
        Insert: {
          available_balance?: number | null;
          created_at?: string | null;
          currency: string;
          id?: string;
          merchant_id: string;
          pending_balance?: number | null;
          total_earned?: number | null;
          total_withdrawn?: number | null;
          updated_at?: string | null;
        };
        Update: {
          available_balance?: number | null;
          created_at?: string | null;
          currency?: string;
          id?: string;
          merchant_id?: string;
          pending_balance?: number | null;
          total_earned?: number | null;
          total_withdrawn?: number | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'merchant_balances_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'merchant_balances_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'merchant_balances_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      merchant_daily_counters: {
        Row: {
          created_at: string | null;
          date_key: string;
          id: string;
          last_sequence: number;
          merchant_id: string;
        };
        Insert: {
          created_at?: string | null;
          date_key?: string;
          id?: string;
          last_sequence?: number;
          merchant_id: string;
        };
        Update: {
          created_at?: string | null;
          date_key?: string;
          id?: string;
          last_sequence?: number;
          merchant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'merchant_daily_counters_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'merchant_daily_counters_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'merchant_daily_counters_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      merchant_email_domains: {
        Row: {
          bounce_host: string | null;
          bounce_value: string | null;
          created_at: string;
          dkim_host: string | null;
          dkim_value: string | null;
          domain: string;
          enabled: boolean;
          id: string;
          merchant_id: string;
          sender_local_part: string;
          status: string;
          updated_at: string;
          verified_at: string | null;
          zeptomail_domain_id: string | null;
        };
        Insert: {
          bounce_host?: string | null;
          bounce_value?: string | null;
          created_at?: string;
          dkim_host?: string | null;
          dkim_value?: string | null;
          domain: string;
          enabled?: boolean;
          id?: string;
          merchant_id: string;
          sender_local_part?: string;
          status?: string;
          updated_at?: string;
          verified_at?: string | null;
          zeptomail_domain_id?: string | null;
        };
        Update: {
          bounce_host?: string | null;
          bounce_value?: string | null;
          created_at?: string;
          dkim_host?: string | null;
          dkim_value?: string | null;
          domain?: string;
          enabled?: boolean;
          id?: string;
          merchant_id?: string;
          sender_local_part?: string;
          status?: string;
          updated_at?: string;
          verified_at?: string | null;
          zeptomail_domain_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'merchant_email_domains_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'merchant_email_domains_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'merchant_email_domains_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      merchant_feature_settings: {
        Row: {
          about_page_enabled: boolean | null;
          agentic_checkout_enabled: boolean;
          auto_blog_enabled: boolean | null;
          auto_generate_schema: boolean | null;
          blog_discover_image_validation_enabled: boolean;
          blog_enabled: boolean | null;
          checkout_collect_phone: boolean | null;
          checkout_require_account: boolean | null;
          checkout_show_order_notes: boolean | null;
          contact_page_enabled: boolean | null;
          created_at: string | null;
          credit_direct_enabled: boolean | null;
          credit_direct_max_amount: number | null;
          credit_direct_min_amount: number | null;
          credit_direct_public_key: string | null;
          credpal_enabled: boolean | null;
          custom_robots_txt: string | null;
          custom_settings: Json | null;
          customer_device_savings_auto_debit_enabled: boolean | null;
          customer_device_savings_break_fee_enabled: boolean | null;
          customer_device_savings_enabled: boolean | null;
          discount_codes_enabled: boolean | null;
          email_notifications_enabled: boolean | null;
          facebook_capi_token: string | null;
          facebook_pixel_id: string | null;
          faq_page_enabled: boolean | null;
          free_shipping_threshold: number | null;
          ga4_api_secret: string | null;
          google_analytics_id: string | null;
          google_place_id: string | null;
          google_reviews_enabled: boolean | null;
          guest_checkout_enabled: boolean | null;
          id: string;
          juicyway_enabled: boolean | null;
          klump_enabled: boolean;
          klump_max_amount: number;
          klump_min_amount: number;
          korapay_enabled: boolean | null;
          low_stock_threshold: number | null;
          loyalty_enabled: boolean | null;
          merchant_id: string;
          order_tracking_enabled: boolean | null;
          pay_on_delivery_enabled: boolean | null;
          paystack_enabled: boolean | null;
          preferred_international_gateway: string | null;
          preferred_local_gateway: string | null;
          privacy_page_enabled: boolean | null;
          repair_settings: Json | null;
          repairs_catalog_enabled: boolean | null;
          reviews_enabled: boolean | null;
          rewards_page_enabled: boolean | null;
          shipping_insurance_enabled: boolean | null;
          shipping_insurance_min_order_value: number | null;
          shipping_insurance_opt_in_default: boolean | null;
          shipping_markup_percentage: number | null;
          shipping_providers: Json | null;
          show_recent_purchases: boolean | null;
          show_stock_levels: boolean | null;
          sms_notifications_enabled: boolean | null;
          snapchat_capi_token: string | null;
          snapchat_pixel_id: string | null;
          terms_page_enabled: boolean | null;
          tiktok_access_token: string | null;
          tiktok_pixel_id: string | null;
          twitter_pixel_id: string | null;
          updated_at: string | null;
          vtu_airtime_enabled: boolean | null;
          vtu_betting_enabled: boolean | null;
          vtu_checkout_addon_amounts: number[] | null;
          vtu_checkout_addon_enabled: boolean | null;
          vtu_customer_cashback_enabled: boolean | null;
          vtu_customer_cashback_rate: number | null;
          vtu_data_enabled: boolean | null;
          vtu_electricity_enabled: boolean | null;
          vtu_enabled: boolean | null;
          vtu_loyalty_reward_enabled: boolean | null;
          vtu_merchant_commission_rate: number | null;
          vtu_tv_enabled: boolean | null;
          wallet_order_auto_debit_enabled: boolean | null;
          wallet_paystack_dva_enabled: boolean | null;
          wishlist_enabled: boolean | null;
        };
        Insert: {
          about_page_enabled?: boolean | null;
          agentic_checkout_enabled?: boolean;
          auto_blog_enabled?: boolean | null;
          auto_generate_schema?: boolean | null;
          blog_discover_image_validation_enabled?: boolean;
          blog_enabled?: boolean | null;
          checkout_collect_phone?: boolean | null;
          checkout_require_account?: boolean | null;
          checkout_show_order_notes?: boolean | null;
          contact_page_enabled?: boolean | null;
          created_at?: string | null;
          credit_direct_enabled?: boolean | null;
          credit_direct_max_amount?: number | null;
          credit_direct_min_amount?: number | null;
          credit_direct_public_key?: string | null;
          credpal_enabled?: boolean | null;
          custom_robots_txt?: string | null;
          custom_settings?: Json | null;
          customer_device_savings_auto_debit_enabled?: boolean | null;
          customer_device_savings_break_fee_enabled?: boolean | null;
          customer_device_savings_enabled?: boolean | null;
          discount_codes_enabled?: boolean | null;
          email_notifications_enabled?: boolean | null;
          facebook_capi_token?: string | null;
          facebook_pixel_id?: string | null;
          faq_page_enabled?: boolean | null;
          free_shipping_threshold?: number | null;
          ga4_api_secret?: string | null;
          google_analytics_id?: string | null;
          google_place_id?: string | null;
          google_reviews_enabled?: boolean | null;
          guest_checkout_enabled?: boolean | null;
          id?: string;
          juicyway_enabled?: boolean | null;
          klump_enabled?: boolean;
          klump_max_amount?: number;
          klump_min_amount?: number;
          korapay_enabled?: boolean | null;
          low_stock_threshold?: number | null;
          loyalty_enabled?: boolean | null;
          merchant_id: string;
          order_tracking_enabled?: boolean | null;
          pay_on_delivery_enabled?: boolean | null;
          paystack_enabled?: boolean | null;
          preferred_international_gateway?: string | null;
          preferred_local_gateway?: string | null;
          privacy_page_enabled?: boolean | null;
          repair_settings?: Json | null;
          repairs_catalog_enabled?: boolean | null;
          reviews_enabled?: boolean | null;
          rewards_page_enabled?: boolean | null;
          shipping_insurance_enabled?: boolean | null;
          shipping_insurance_min_order_value?: number | null;
          shipping_insurance_opt_in_default?: boolean | null;
          shipping_markup_percentage?: number | null;
          shipping_providers?: Json | null;
          show_recent_purchases?: boolean | null;
          show_stock_levels?: boolean | null;
          sms_notifications_enabled?: boolean | null;
          snapchat_capi_token?: string | null;
          snapchat_pixel_id?: string | null;
          terms_page_enabled?: boolean | null;
          tiktok_access_token?: string | null;
          tiktok_pixel_id?: string | null;
          twitter_pixel_id?: string | null;
          updated_at?: string | null;
          vtu_airtime_enabled?: boolean | null;
          vtu_betting_enabled?: boolean | null;
          vtu_checkout_addon_amounts?: number[] | null;
          vtu_checkout_addon_enabled?: boolean | null;
          vtu_customer_cashback_enabled?: boolean | null;
          vtu_customer_cashback_rate?: number | null;
          vtu_data_enabled?: boolean | null;
          vtu_electricity_enabled?: boolean | null;
          vtu_enabled?: boolean | null;
          vtu_loyalty_reward_enabled?: boolean | null;
          vtu_merchant_commission_rate?: number | null;
          vtu_tv_enabled?: boolean | null;
          wallet_order_auto_debit_enabled?: boolean | null;
          wallet_paystack_dva_enabled?: boolean | null;
          wishlist_enabled?: boolean | null;
        };
        Update: {
          about_page_enabled?: boolean | null;
          agentic_checkout_enabled?: boolean;
          auto_blog_enabled?: boolean | null;
          auto_generate_schema?: boolean | null;
          blog_discover_image_validation_enabled?: boolean;
          blog_enabled?: boolean | null;
          checkout_collect_phone?: boolean | null;
          checkout_require_account?: boolean | null;
          checkout_show_order_notes?: boolean | null;
          contact_page_enabled?: boolean | null;
          created_at?: string | null;
          credit_direct_enabled?: boolean | null;
          credit_direct_max_amount?: number | null;
          credit_direct_min_amount?: number | null;
          credit_direct_public_key?: string | null;
          credpal_enabled?: boolean | null;
          custom_robots_txt?: string | null;
          custom_settings?: Json | null;
          customer_device_savings_auto_debit_enabled?: boolean | null;
          customer_device_savings_break_fee_enabled?: boolean | null;
          customer_device_savings_enabled?: boolean | null;
          discount_codes_enabled?: boolean | null;
          email_notifications_enabled?: boolean | null;
          facebook_capi_token?: string | null;
          facebook_pixel_id?: string | null;
          faq_page_enabled?: boolean | null;
          free_shipping_threshold?: number | null;
          ga4_api_secret?: string | null;
          google_analytics_id?: string | null;
          google_place_id?: string | null;
          google_reviews_enabled?: boolean | null;
          guest_checkout_enabled?: boolean | null;
          id?: string;
          juicyway_enabled?: boolean | null;
          klump_enabled?: boolean;
          klump_max_amount?: number;
          klump_min_amount?: number;
          korapay_enabled?: boolean | null;
          low_stock_threshold?: number | null;
          loyalty_enabled?: boolean | null;
          merchant_id?: string;
          order_tracking_enabled?: boolean | null;
          pay_on_delivery_enabled?: boolean | null;
          paystack_enabled?: boolean | null;
          preferred_international_gateway?: string | null;
          preferred_local_gateway?: string | null;
          privacy_page_enabled?: boolean | null;
          repair_settings?: Json | null;
          repairs_catalog_enabled?: boolean | null;
          reviews_enabled?: boolean | null;
          rewards_page_enabled?: boolean | null;
          shipping_insurance_enabled?: boolean | null;
          shipping_insurance_min_order_value?: number | null;
          shipping_insurance_opt_in_default?: boolean | null;
          shipping_markup_percentage?: number | null;
          shipping_providers?: Json | null;
          show_recent_purchases?: boolean | null;
          show_stock_levels?: boolean | null;
          sms_notifications_enabled?: boolean | null;
          snapchat_capi_token?: string | null;
          snapchat_pixel_id?: string | null;
          terms_page_enabled?: boolean | null;
          tiktok_access_token?: string | null;
          tiktok_pixel_id?: string | null;
          twitter_pixel_id?: string | null;
          updated_at?: string | null;
          vtu_airtime_enabled?: boolean | null;
          vtu_betting_enabled?: boolean | null;
          vtu_checkout_addon_amounts?: number[] | null;
          vtu_checkout_addon_enabled?: boolean | null;
          vtu_customer_cashback_enabled?: boolean | null;
          vtu_customer_cashback_rate?: number | null;
          vtu_data_enabled?: boolean | null;
          vtu_electricity_enabled?: boolean | null;
          vtu_enabled?: boolean | null;
          vtu_loyalty_reward_enabled?: boolean | null;
          vtu_merchant_commission_rate?: number | null;
          vtu_tv_enabled?: boolean | null;
          wallet_order_auto_debit_enabled?: boolean | null;
          wallet_paystack_dva_enabled?: boolean | null;
          wishlist_enabled?: boolean | null;
        };
        Relationships: [
          {
            foreignKeyName: 'merchant_feature_settings_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'merchant_feature_settings_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'merchant_feature_settings_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      merchant_notifications: {
        Row: {
          banner_dismissed_at: string | null;
          banner_visible: boolean;
          created_at: string | null;
          dismissed_at: string | null;
          id: string;
          in_app_visible: boolean;
          merchant_id: string;
          notification_id: string;
          read_at: string | null;
        };
        Insert: {
          banner_dismissed_at?: string | null;
          banner_visible?: boolean;
          created_at?: string | null;
          dismissed_at?: string | null;
          id?: string;
          in_app_visible?: boolean;
          merchant_id: string;
          notification_id: string;
          read_at?: string | null;
        };
        Update: {
          banner_dismissed_at?: string | null;
          banner_visible?: boolean;
          created_at?: string | null;
          dismissed_at?: string | null;
          id?: string;
          in_app_visible?: boolean;
          merchant_id?: string;
          notification_id?: string;
          read_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'merchant_notifications_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'merchant_notifications_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'merchant_notifications_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'merchant_notifications_notification_id_fkey';
            columns: ['notification_id'];
            isOneToOne: false;
            referencedRelation: 'notifications';
            referencedColumns: ['id'];
          },
        ];
      };
      merchant_order_counters: {
        Row: {
          last_order_number: number;
          merchant_id: string;
        };
        Insert: {
          last_order_number?: number;
          merchant_id: string;
        };
        Update: {
          last_order_number?: number;
          merchant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'merchant_order_counters_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'merchant_order_counters_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'merchant_order_counters_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      merchant_settlements: {
        Row: {
          actual_settlement_date: string | null;
          created_at: string | null;
          description: string | null;
          expected_settlement_date: string;
          gateway: string;
          gateway_fee: number | null;
          gateway_reference: string | null;
          gross_amount: number;
          id: string;
          merchant_id: string;
          metadata: Json | null;
          net_amount: number;
          notification_sent_at: string | null;
          payment_date: string;
          platform_fee: number | null;
          settlement_notified: boolean | null;
          source_id: string | null;
          source_type: string;
          status: string;
          updated_at: string | null;
          wallet_id: string | null;
        };
        Insert: {
          actual_settlement_date?: string | null;
          created_at?: string | null;
          description?: string | null;
          expected_settlement_date: string;
          gateway: string;
          gateway_fee?: number | null;
          gateway_reference?: string | null;
          gross_amount: number;
          id?: string;
          merchant_id: string;
          metadata?: Json | null;
          net_amount: number;
          notification_sent_at?: string | null;
          payment_date?: string;
          platform_fee?: number | null;
          settlement_notified?: boolean | null;
          source_id?: string | null;
          source_type: string;
          status?: string;
          updated_at?: string | null;
          wallet_id?: string | null;
        };
        Update: {
          actual_settlement_date?: string | null;
          created_at?: string | null;
          description?: string | null;
          expected_settlement_date?: string;
          gateway?: string;
          gateway_fee?: number | null;
          gateway_reference?: string | null;
          gross_amount?: number;
          id?: string;
          merchant_id?: string;
          metadata?: Json | null;
          net_amount?: number;
          notification_sent_at?: string | null;
          payment_date?: string;
          platform_fee?: number | null;
          settlement_notified?: boolean | null;
          source_id?: string | null;
          source_type?: string;
          status?: string;
          updated_at?: string | null;
          wallet_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'merchant_settlements_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'merchant_settlements_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'merchant_settlements_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'merchant_settlements_wallet_id_fkey';
            columns: ['wallet_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_wallets';
            referencedColumns: ['id'];
          },
        ];
      };
      merchant_shipping_rates: {
        Row: {
          active: boolean;
          base_amount: number;
          condition_type: string;
          created_at: string;
          currency: string;
          delivery_max_days: number | null;
          delivery_min_days: number | null;
          free_over_amount: number | null;
          id: string;
          kind: string;
          max_subtotal: number | null;
          merchant_id: string;
          min_subtotal: number | null;
          name: string;
          pickup_address: Json | null;
          sort_order: number;
          updated_at: string;
          zone_id: string;
        };
        Insert: {
          active?: boolean;
          base_amount?: number;
          condition_type?: string;
          created_at?: string;
          currency: string;
          delivery_max_days?: number | null;
          delivery_min_days?: number | null;
          free_over_amount?: number | null;
          id?: string;
          kind?: string;
          max_subtotal?: number | null;
          merchant_id: string;
          min_subtotal?: number | null;
          name: string;
          pickup_address?: Json | null;
          sort_order?: number;
          updated_at?: string;
          zone_id: string;
        };
        Update: {
          active?: boolean;
          base_amount?: number;
          condition_type?: string;
          created_at?: string;
          currency?: string;
          delivery_max_days?: number | null;
          delivery_min_days?: number | null;
          free_over_amount?: number | null;
          id?: string;
          kind?: string;
          max_subtotal?: number | null;
          merchant_id?: string;
          min_subtotal?: number | null;
          name?: string;
          pickup_address?: Json | null;
          sort_order?: number;
          updated_at?: string;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'merchant_shipping_rates_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'merchant_shipping_rates_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'merchant_shipping_rates_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'merchant_shipping_rates_zone_merchant_fkey';
            columns: ['zone_id', 'merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_shipping_zones';
            referencedColumns: ['id', 'merchant_id'];
          },
        ];
      };
      merchant_shipping_zone_locations: {
        Row: {
          country_code: string;
          created_at: string;
          id: string;
          merchant_id: string;
          subdivision_code: string | null;
          zone_id: string;
        };
        Insert: {
          country_code: string;
          created_at?: string;
          id?: string;
          merchant_id: string;
          subdivision_code?: string | null;
          zone_id: string;
        };
        Update: {
          country_code?: string;
          created_at?: string;
          id?: string;
          merchant_id?: string;
          subdivision_code?: string | null;
          zone_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'merchant_shipping_zone_locations_zone_merchant_fkey';
            columns: ['zone_id', 'merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_shipping_zones';
            referencedColumns: ['id', 'merchant_id'];
          },
        ];
      };
      merchant_shipping_zones: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          is_rest_of_world: boolean;
          merchant_id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          is_rest_of_world?: boolean;
          merchant_id: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          is_rest_of_world?: boolean;
          merchant_id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'merchant_shipping_zones_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'merchant_shipping_zones_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'merchant_shipping_zones_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      merchant_slug_aliases: {
        Row: {
          created_at: string;
          merchant_id: string;
          old_slug: string;
        };
        Insert: {
          created_at?: string;
          merchant_id: string;
          old_slug: string;
        };
        Update: {
          created_at?: string;
          merchant_id?: string;
          old_slug?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'merchant_slug_aliases_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'merchant_slug_aliases_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'merchant_slug_aliases_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      merchant_verifications: {
        Row: {
          bvn_verified: boolean | null;
          bvn_verified_at: string | null;
          cac_approved_name: string | null;
          cac_certificate_path: string | null;
          cac_verified: boolean | null;
          cac_verified_at: string | null;
          created_at: string | null;
          date_of_birth: string | null;
          first_name: string | null;
          id: string;
          last_name: string | null;
          merchant_id: string;
          nin_verified: boolean | null;
          nin_verified_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          bvn_verified?: boolean | null;
          bvn_verified_at?: string | null;
          cac_approved_name?: string | null;
          cac_certificate_path?: string | null;
          cac_verified?: boolean | null;
          cac_verified_at?: string | null;
          created_at?: string | null;
          date_of_birth?: string | null;
          first_name?: string | null;
          id?: string;
          last_name?: string | null;
          merchant_id: string;
          nin_verified?: boolean | null;
          nin_verified_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          bvn_verified?: boolean | null;
          bvn_verified_at?: string | null;
          cac_approved_name?: string | null;
          cac_certificate_path?: string | null;
          cac_verified?: boolean | null;
          cac_verified_at?: string | null;
          created_at?: string | null;
          date_of_birth?: string | null;
          first_name?: string | null;
          id?: string;
          last_name?: string | null;
          merchant_id?: string;
          nin_verified?: boolean | null;
          nin_verified_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'merchant_verifications_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'merchant_verifications_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'merchant_verifications_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      merchant_wallets: {
        Row: {
          auto_payout_day: string | null;
          auto_payout_enabled: boolean | null;
          available_balance: number | null;
          created_at: string | null;
          id: string;
          last_payout_amount: number | null;
          last_payout_at: string | null;
          merchant_id: string;
          min_payout_amount: number | null;
          pending_balance: number | null;
          total_earned: number | null;
          total_withdrawn: number | null;
          upcoming_balance: number | null;
          upcoming_count: number | null;
          updated_at: string | null;
        };
        Insert: {
          auto_payout_day?: string | null;
          auto_payout_enabled?: boolean | null;
          available_balance?: number | null;
          created_at?: string | null;
          id?: string;
          last_payout_amount?: number | null;
          last_payout_at?: string | null;
          merchant_id: string;
          min_payout_amount?: number | null;
          pending_balance?: number | null;
          total_earned?: number | null;
          total_withdrawn?: number | null;
          upcoming_balance?: number | null;
          upcoming_count?: number | null;
          updated_at?: string | null;
        };
        Update: {
          auto_payout_day?: string | null;
          auto_payout_enabled?: boolean | null;
          available_balance?: number | null;
          created_at?: string | null;
          id?: string;
          last_payout_amount?: number | null;
          last_payout_at?: string | null;
          merchant_id?: string;
          min_payout_amount?: number | null;
          pending_balance?: number | null;
          total_earned?: number | null;
          total_withdrawn?: number | null;
          upcoming_balance?: number | null;
          upcoming_count?: number | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'merchant_wallets_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'merchant_wallets_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'merchant_wallets_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      merchants: {
        Row: {
          about_page: Json | null;
          bank_account_name: string | null;
          bank_account_number: string | null;
          bank_code: string | null;
          bank_name: string | null;
          brand_colors: Json | null;
          business_address: string | null;
          business_name: string | null;
          business_type: string | null;
          bvn: string | null;
          cac_number: string | null;
          cac_rc_number: string | null;
          country: string | null;
          created_at: string | null;
          email: string;
          email_domain: string | null;
          email_domain_verified: boolean | null;
          email_logo_url: string | null;
          email_sender_name: string | null;
          endpoint_id: string | null;
          endpoint_scheme_id: string | null;
          facebook_capi_access_token: string | null;
          facebook_capi_token: string | null;
          facebook_pixel_id: string | null;
          faq_items: Json | null;
          favicon_apple_touch_url: string | null;
          favicon_png_192_url: string | null;
          favicon_png_32_url: string | null;
          favicon_svg_url: string | null;
          favicon_uploaded_at: string | null;
          feature_settings: Json | null;
          firs_business_id: string | null;
          firs_certificate: string | null;
          firs_email: string | null;
          firs_password_encrypted: string | null;
          firs_public_key: string | null;
          firs_service_id: string | null;
          ga4_api_secret: string | null;
          gmc_variants_enabled: boolean | null;
          google_analytics_id: string | null;
          google_product_sheet_url: string | null;
          hero_image_ids: string[] | null;
          hero_images_generated_at: string | null;
          hero_images_regeneration_count: number | null;
          hero_slides: Json | null;
          id: string;
          is_platform_admin: boolean | null;
          is_published: boolean | null;
          kyc_status: string | null;
          legal_entity_name: string | null;
          lga_code: string | null;
          logo_url: string | null;
          mobile_hero_slides: Json;
          multi_currency_enabled: boolean | null;
          nin: string | null;
          offline_conversions_enabled: boolean | null;
          order_prefix: string | null;
          pages: Json | null;
          payout_currency: string;
          paystack_subaccount_code: string | null;
          phone: string | null;
          plan_expires_at: string | null;
          plan_started_at: string | null;
          plan_tier: string | null;
          premium_features: Json | null;
          published_at: string | null;
          published_config: Json | null;
          registered_address: Json | null;
          rider_phone_number: string | null;
          self_fulfillment_enabled: boolean | null;
          signup_source: string;
          site_description: string | null;
          site_tagline: string | null;
          site_title: string | null;
          slug: string | null;
          snapchat_capi_token: string | null;
          snapchat_pixel_id: string | null;
          social_media: Json | null;
          state_code: string | null;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          support_email: string | null;
          support_phone: string | null;
          tax_exempt: boolean | null;
          tax_identification_number: string | null;
          template_id: string | null;
          tiktok_access_token: string | null;
          tiktok_pixel_id: string | null;
          trust_profile: Json;
          twitter_pixel_id: string | null;
          updated_at: string;
          user_id: string | null;
          vat_rate: number | null;
          vat_registration_status: string | null;
          virtual_terminal_code: string | null;
        };
        Insert: {
          about_page?: Json | null;
          bank_account_name?: string | null;
          bank_account_number?: string | null;
          bank_code?: string | null;
          bank_name?: string | null;
          brand_colors?: Json | null;
          business_address?: string | null;
          business_name?: string | null;
          business_type?: string | null;
          bvn?: string | null;
          cac_number?: string | null;
          cac_rc_number?: string | null;
          country?: string | null;
          created_at?: string | null;
          email: string;
          email_domain?: string | null;
          email_domain_verified?: boolean | null;
          email_logo_url?: string | null;
          email_sender_name?: string | null;
          endpoint_id?: string | null;
          endpoint_scheme_id?: string | null;
          facebook_capi_access_token?: string | null;
          facebook_capi_token?: string | null;
          facebook_pixel_id?: string | null;
          faq_items?: Json | null;
          favicon_apple_touch_url?: string | null;
          favicon_png_192_url?: string | null;
          favicon_png_32_url?: string | null;
          favicon_svg_url?: string | null;
          favicon_uploaded_at?: string | null;
          feature_settings?: Json | null;
          firs_business_id?: string | null;
          firs_certificate?: string | null;
          firs_email?: string | null;
          firs_password_encrypted?: string | null;
          firs_public_key?: string | null;
          firs_service_id?: string | null;
          ga4_api_secret?: string | null;
          gmc_variants_enabled?: boolean | null;
          google_analytics_id?: string | null;
          google_product_sheet_url?: string | null;
          hero_image_ids?: string[] | null;
          hero_images_generated_at?: string | null;
          hero_images_regeneration_count?: number | null;
          hero_slides?: Json | null;
          id?: string;
          is_platform_admin?: boolean | null;
          is_published?: boolean | null;
          kyc_status?: string | null;
          legal_entity_name?: string | null;
          lga_code?: string | null;
          logo_url?: string | null;
          mobile_hero_slides?: Json;
          multi_currency_enabled?: boolean | null;
          nin?: string | null;
          offline_conversions_enabled?: boolean | null;
          order_prefix?: string | null;
          pages?: Json | null;
          payout_currency?: string;
          paystack_subaccount_code?: string | null;
          phone?: string | null;
          plan_expires_at?: string | null;
          plan_started_at?: string | null;
          plan_tier?: string | null;
          premium_features?: Json | null;
          published_at?: string | null;
          published_config?: Json | null;
          registered_address?: Json | null;
          rider_phone_number?: string | null;
          self_fulfillment_enabled?: boolean | null;
          signup_source?: string;
          site_description?: string | null;
          site_tagline?: string | null;
          site_title?: string | null;
          slug?: string | null;
          snapchat_capi_token?: string | null;
          snapchat_pixel_id?: string | null;
          social_media?: Json | null;
          state_code?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          support_email?: string | null;
          support_phone?: string | null;
          tax_exempt?: boolean | null;
          tax_identification_number?: string | null;
          template_id?: string | null;
          tiktok_access_token?: string | null;
          tiktok_pixel_id?: string | null;
          trust_profile?: Json;
          twitter_pixel_id?: string | null;
          updated_at?: string;
          user_id?: string | null;
          vat_rate?: number | null;
          vat_registration_status?: string | null;
          virtual_terminal_code?: string | null;
        };
        Update: {
          about_page?: Json | null;
          bank_account_name?: string | null;
          bank_account_number?: string | null;
          bank_code?: string | null;
          bank_name?: string | null;
          brand_colors?: Json | null;
          business_address?: string | null;
          business_name?: string | null;
          business_type?: string | null;
          bvn?: string | null;
          cac_number?: string | null;
          cac_rc_number?: string | null;
          country?: string | null;
          created_at?: string | null;
          email?: string;
          email_domain?: string | null;
          email_domain_verified?: boolean | null;
          email_logo_url?: string | null;
          email_sender_name?: string | null;
          endpoint_id?: string | null;
          endpoint_scheme_id?: string | null;
          facebook_capi_access_token?: string | null;
          facebook_capi_token?: string | null;
          facebook_pixel_id?: string | null;
          faq_items?: Json | null;
          favicon_apple_touch_url?: string | null;
          favicon_png_192_url?: string | null;
          favicon_png_32_url?: string | null;
          favicon_svg_url?: string | null;
          favicon_uploaded_at?: string | null;
          feature_settings?: Json | null;
          firs_business_id?: string | null;
          firs_certificate?: string | null;
          firs_email?: string | null;
          firs_password_encrypted?: string | null;
          firs_public_key?: string | null;
          firs_service_id?: string | null;
          ga4_api_secret?: string | null;
          gmc_variants_enabled?: boolean | null;
          google_analytics_id?: string | null;
          google_product_sheet_url?: string | null;
          hero_image_ids?: string[] | null;
          hero_images_generated_at?: string | null;
          hero_images_regeneration_count?: number | null;
          hero_slides?: Json | null;
          id?: string;
          is_platform_admin?: boolean | null;
          is_published?: boolean | null;
          kyc_status?: string | null;
          legal_entity_name?: string | null;
          lga_code?: string | null;
          logo_url?: string | null;
          mobile_hero_slides?: Json;
          multi_currency_enabled?: boolean | null;
          nin?: string | null;
          offline_conversions_enabled?: boolean | null;
          order_prefix?: string | null;
          pages?: Json | null;
          payout_currency?: string;
          paystack_subaccount_code?: string | null;
          phone?: string | null;
          plan_expires_at?: string | null;
          plan_started_at?: string | null;
          plan_tier?: string | null;
          premium_features?: Json | null;
          published_at?: string | null;
          published_config?: Json | null;
          registered_address?: Json | null;
          rider_phone_number?: string | null;
          self_fulfillment_enabled?: boolean | null;
          signup_source?: string;
          site_description?: string | null;
          site_tagline?: string | null;
          site_title?: string | null;
          slug?: string | null;
          snapchat_capi_token?: string | null;
          snapchat_pixel_id?: string | null;
          social_media?: Json | null;
          state_code?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          support_email?: string | null;
          support_phone?: string | null;
          tax_exempt?: boolean | null;
          tax_identification_number?: string | null;
          template_id?: string | null;
          tiktok_access_token?: string | null;
          tiktok_pixel_id?: string | null;
          trust_profile?: Json;
          twitter_pixel_id?: string | null;
          updated_at?: string;
          user_id?: string | null;
          vat_rate?: number | null;
          vat_registration_status?: string | null;
          virtual_terminal_code?: string | null;
        };
        Relationships: [];
      };
      mobile_release_gate: {
        Row: {
          app: string;
          latest_live_build: number;
          platform: string;
          source: string;
          updated_at: string;
        };
        Insert: {
          app?: string;
          latest_live_build: number;
          platform: string;
          source?: string;
          updated_at?: string;
        };
        Update: {
          app?: string;
          latest_live_build?: number;
          platform?: string;
          source?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      mycover_webhook_events: {
        Row: {
          event: string | null;
          event_id: string;
          processed_at: string | null;
          processing_status: string;
          received_at: string | null;
        };
        Insert: {
          event?: string | null;
          event_id: string;
          processed_at?: string | null;
          processing_status?: string;
          received_at?: string | null;
        };
        Update: {
          event?: string | null;
          event_id?: string;
          processed_at?: string | null;
          processing_status?: string;
          received_at?: string | null;
        };
        Relationships: [];
      };
      negotiation_request_customer_email_audit: {
        Row: {
          captured_at: string;
          customer_email: string;
          merchant_id: string | null;
          negotiation_request_id: string;
          reason: string;
        };
        Insert: {
          captured_at?: string;
          customer_email: string;
          merchant_id?: string | null;
          negotiation_request_id: string;
          reason?: string;
        };
        Update: {
          captured_at?: string;
          customer_email?: string;
          merchant_id?: string | null;
          negotiation_request_id?: string;
          reason?: string;
        };
        Relationships: [];
      };
      negotiation_requests: {
        Row: {
          cart_snapshot: Json | null;
          counter_offer: number | null;
          created_at: string | null;
          customer_email: string | null;
          customer_id: string | null;
          customer_phone: string | null;
          evidence_url: string | null;
          id: string;
          item_info: Json | null;
          merchant_id: string;
          merchant_notes: string | null;
          offered_price: number;
          session_id: string;
          status: Database['public']['Enums']['negotiation_status'] | null;
          type: string;
          updated_at: string | null;
        };
        Insert: {
          cart_snapshot?: Json | null;
          counter_offer?: number | null;
          created_at?: string | null;
          customer_email?: string | null;
          customer_id?: string | null;
          customer_phone?: string | null;
          evidence_url?: string | null;
          id?: string;
          item_info?: Json | null;
          merchant_id: string;
          merchant_notes?: string | null;
          offered_price: number;
          session_id: string;
          status?: Database['public']['Enums']['negotiation_status'] | null;
          type: string;
          updated_at?: string | null;
        };
        Update: {
          cart_snapshot?: Json | null;
          counter_offer?: number | null;
          created_at?: string | null;
          customer_email?: string | null;
          customer_id?: string | null;
          customer_phone?: string | null;
          evidence_url?: string | null;
          id?: string;
          item_info?: Json | null;
          merchant_id?: string;
          merchant_notes?: string | null;
          offered_price?: number;
          session_id?: string;
          status?: Database['public']['Enums']['negotiation_status'] | null;
          type?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'negotiation_requests_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'negotiation_requests_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'negotiation_requests_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      newsletter_subscribers: {
        Row: {
          created_at: string | null;
          email: string;
          id: string;
          merchant_id: string | null;
          resubscribed_at: string | null;
          source: string | null;
          status: string;
          subscribed_at: string | null;
          unsubscribed_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          email: string;
          id?: string;
          merchant_id?: string | null;
          resubscribed_at?: string | null;
          source?: string | null;
          status?: string;
          subscribed_at?: string | null;
          unsubscribed_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          email?: string;
          id?: string;
          merchant_id?: string | null;
          resubscribed_at?: string | null;
          source?: string | null;
          status?: string;
          subscribed_at?: string | null;
          unsubscribed_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'newsletter_subscribers_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'newsletter_subscribers_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'newsletter_subscribers_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      notification_preferences: {
        Row: {
          banner_enabled: boolean | null;
          follow_up_notifications_enabled: boolean;
          in_app_enabled: boolean | null;
          merchant_id: string;
          quiet_hours_end: string | null;
          quiet_hours_start: string | null;
          quiet_hours_time_zone: string;
          updated_at: string | null;
        };
        Insert: {
          banner_enabled?: boolean | null;
          follow_up_notifications_enabled?: boolean;
          in_app_enabled?: boolean | null;
          merchant_id: string;
          quiet_hours_end?: string | null;
          quiet_hours_start?: string | null;
          quiet_hours_time_zone?: string;
          updated_at?: string | null;
        };
        Update: {
          banner_enabled?: boolean | null;
          follow_up_notifications_enabled?: boolean;
          in_app_enabled?: boolean | null;
          merchant_id?: string;
          quiet_hours_end?: string | null;
          quiet_hours_start?: string | null;
          quiet_hours_time_zone?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_preferences_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'notification_preferences_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notification_preferences_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: true;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      notification_templates: {
        Row: {
          channels: Json;
          created_at: string | null;
          id: string;
          message_template: string;
          name: string;
          notification_type: string;
          priority: string;
          updated_at: string | null;
        };
        Insert: {
          channels?: Json;
          created_at?: string | null;
          id?: string;
          message_template: string;
          name: string;
          notification_type: string;
          priority?: string;
          updated_at?: string | null;
        };
        Update: {
          channels?: Json;
          created_at?: string | null;
          id?: string;
          message_template?: string;
          name?: string;
          notification_type?: string;
          priority?: string;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          action_label: string | null;
          action_url: string | null;
          channels: Json;
          created_at: string | null;
          created_by: string;
          delivery_attempts: number;
          delivery_claimed_at: string | null;
          delivery_claim_token: string | null;
          delivery_failed_at: string | null;
          delivery_failure_attempts: number;
          delivery_last_error: string | null;
          delivery_state: string;
          expires_at: string | null;
          id: string;
          is_system: boolean | null;
          message: string;
          notification_type: string;
          priority: string;
          scheduled_for: string | null;
          sent_at: string | null;
          target_merchant_ids: string[] | null;
          target_segment: string | null;
          target_type: string;
          template_id: string | null;
          title: string;
        };
        Insert: {
          action_label?: string | null;
          action_url?: string | null;
          channels?: Json;
          created_at?: string | null;
          created_by: string;
          delivery_attempts?: number;
          delivery_claimed_at?: string | null;
          delivery_claim_token?: string | null;
          delivery_failed_at?: string | null;
          delivery_failure_attempts?: number;
          delivery_last_error?: string | null;
          delivery_state?: string;
          expires_at?: string | null;
          id?: string;
          is_system?: boolean | null;
          message: string;
          notification_type?: string;
          priority?: string;
          scheduled_for?: string | null;
          sent_at?: string | null;
          target_merchant_ids?: string[] | null;
          target_segment?: string | null;
          target_type?: string;
          template_id?: string | null;
          title: string;
        };
        Update: {
          action_label?: string | null;
          action_url?: string | null;
          channels?: Json;
          created_at?: string | null;
          created_by?: string;
          delivery_attempts?: number;
          delivery_claimed_at?: string | null;
          delivery_claim_token?: string | null;
          delivery_failed_at?: string | null;
          delivery_failure_attempts?: number;
          delivery_last_error?: string | null;
          delivery_state?: string;
          expires_at?: string | null;
          id?: string;
          is_system?: boolean | null;
          message?: string;
          notification_type?: string;
          priority?: string;
          scheduled_for?: string | null;
          sent_at?: string | null;
          target_merchant_ids?: string[] | null;
          target_segment?: string | null;
          target_type?: string;
          template_id?: string | null;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_template_id_fkey';
            columns: ['template_id'];
            isOneToOne: false;
            referencedRelation: 'notification_templates';
            referencedColumns: ['id'];
          },
        ];
      };
      oauth_handoff_tickets: {
        Row: {
          created_at: string;
          exchanged_at: string | null;
          expires_at: string;
          id: string;
          merchant_id: string;
          oauth_state: string | null;
          redeemed_at: string | null;
          status: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          exchanged_at?: string | null;
          expires_at: string;
          id?: string;
          merchant_id: string;
          oauth_state?: string | null;
          redeemed_at?: string | null;
          status?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          exchanged_at?: string | null;
          expires_at?: string;
          id?: string;
          merchant_id?: string;
          oauth_state?: string | null;
          redeemed_at?: string | null;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'oauth_handoff_tickets_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'oauth_handoff_tickets_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'oauth_handoff_tickets_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      order_audit_events: {
        Row: {
          action: string;
          actor_user_id: string;
          after_snapshot: Json;
          before_snapshot: Json;
          change_category: string;
          changed_fields: string[];
          created_at: string;
          id: string;
          merchant_id: string;
          metadata: Json;
          order_id: string;
        };
        Insert: {
          action: string;
          actor_user_id: string;
          after_snapshot: Json;
          before_snapshot: Json;
          change_category?: string;
          changed_fields?: string[];
          created_at?: string;
          id?: string;
          merchant_id: string;
          metadata?: Json;
          order_id: string;
        };
        Update: {
          action?: string;
          actor_user_id?: string;
          after_snapshot?: Json;
          before_snapshot?: Json;
          change_category?: string;
          changed_fields?: string[];
          created_at?: string;
          id?: string;
          merchant_id?: string;
          metadata?: Json;
          order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'order_audit_events_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'order_audit_events_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_audit_events_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'order_audit_events_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      order_cancellation_side_effects: {
        Row: {
          attempts: number;
          claim_token: string;
          claimed_at: string;
          completed_at: string | null;
          error: string | null;
          merchant_id: string;
          order_id: string;
          result: Json | null;
          status: string;
          step: string;
        };
        Insert: {
          attempts?: number;
          claim_token: string;
          claimed_at?: string;
          completed_at?: string | null;
          error?: string | null;
          merchant_id: string;
          order_id: string;
          result?: Json | null;
          status: string;
          step: string;
        };
        Update: {
          attempts?: number;
          claim_token?: string;
          claimed_at?: string;
          completed_at?: string | null;
          error?: string | null;
          merchant_id?: string;
          order_id?: string;
          result?: Json | null;
          status?: string;
          step?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'order_cancellation_side_effects_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'order_cancellation_side_effects_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_cancellation_side_effects_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'order_cancellation_side_effects_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      order_insurance_policies: {
        Row: {
          activation_reminder_sent_at: string | null;
          certificate_url: string | null;
          claim_comment: string | null;
          claim_id: string | null;
          claim_link: string | null;
          claim_progress: string | null;
          claim_stage: string | null;
          claim_status: string | null;
          coverage_amount: number;
          created_at: string | null;
          customer_email: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          id: string;
          inspection_link: string | null;
          inspection_status: string | null;
          items_insured: Json;
          merchant_id: string;
          mycover_customer_id: string | null;
          mycover_policy_id: string;
          mycover_policy_number: string | null;
          mycover_product_id: string | null;
          mycover_purchase_id: string | null;
          order_id: string;
          policy_expiry_date: string | null;
          policy_start_date: string | null;
          policy_type: string | null;
          premium_amount: number;
          premium_currency: string | null;
          provider_name: string | null;
          shipping_address: Json | null;
          status: string | null;
          updated_at: string | null;
        };
        Insert: {
          activation_reminder_sent_at?: string | null;
          certificate_url?: string | null;
          claim_comment?: string | null;
          claim_id?: string | null;
          claim_link?: string | null;
          claim_progress?: string | null;
          claim_stage?: string | null;
          claim_status?: string | null;
          coverage_amount: number;
          created_at?: string | null;
          customer_email?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          id?: string;
          inspection_link?: string | null;
          inspection_status?: string | null;
          items_insured: Json;
          merchant_id: string;
          mycover_customer_id?: string | null;
          mycover_policy_id: string;
          mycover_policy_number?: string | null;
          mycover_product_id?: string | null;
          mycover_purchase_id?: string | null;
          order_id: string;
          policy_expiry_date?: string | null;
          policy_start_date?: string | null;
          policy_type?: string | null;
          premium_amount: number;
          premium_currency?: string | null;
          provider_name?: string | null;
          shipping_address?: Json | null;
          status?: string | null;
          updated_at?: string | null;
        };
        Update: {
          activation_reminder_sent_at?: string | null;
          certificate_url?: string | null;
          claim_comment?: string | null;
          claim_id?: string | null;
          claim_link?: string | null;
          claim_progress?: string | null;
          claim_stage?: string | null;
          claim_status?: string | null;
          coverage_amount?: number;
          created_at?: string | null;
          customer_email?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          id?: string;
          inspection_link?: string | null;
          inspection_status?: string | null;
          items_insured?: Json;
          merchant_id?: string;
          mycover_customer_id?: string | null;
          mycover_policy_id?: string;
          mycover_policy_number?: string | null;
          mycover_product_id?: string | null;
          mycover_purchase_id?: string | null;
          order_id?: string;
          policy_expiry_date?: string | null;
          policy_start_date?: string | null;
          policy_type?: string | null;
          premium_amount?: number;
          premium_currency?: string | null;
          provider_name?: string | null;
          shipping_address?: Json | null;
          status?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'order_insurance_policies_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'order_insurance_policies_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_insurance_policies_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'order_insurance_policies_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: true;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      order_item_unit_costs: {
        Row: {
          cost_price: number;
          created_at: string;
          id: string;
          identifier_type: string | null;
          identifier_value: string | null;
          merchant_id: string;
          order_id: string;
          order_item_id: string;
          supplier_name: string | null;
          unit_index: number;
          updated_at: string;
        };
        Insert: {
          cost_price: number;
          created_at?: string;
          id?: string;
          identifier_type?: string | null;
          identifier_value?: string | null;
          merchant_id: string;
          order_id: string;
          order_item_id: string;
          supplier_name?: string | null;
          unit_index: number;
          updated_at?: string;
        };
        Update: {
          cost_price?: number;
          created_at?: string;
          id?: string;
          identifier_type?: string | null;
          identifier_value?: string | null;
          merchant_id?: string;
          order_id?: string;
          order_item_id?: string;
          supplier_name?: string | null;
          unit_index?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'order_item_unit_costs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'order_item_unit_costs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_item_unit_costs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'order_item_unit_costs_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_item_unit_costs_order_item_id_fkey';
            columns: ['order_item_id'];
            isOneToOne: false;
            referencedRelation: 'order_items';
            referencedColumns: ['id'];
          },
        ];
      };
      order_items: {
        Row: {
          assurance_fee: number | null;
          condition: string | null;
          cost_price: number | null;
          created_at: string | null;
          fulfillment_data: Json | null;
          has_assurance: boolean | null;
          id: string;
          image_url: string | null;
          item_description: string | null;
          line_extension_amount: number | null;
          line_id: number | null;
          name: string;
          order_id: string;
          price: number;
          product_id: string | null;
          product_match_status: string;
          quantity: number;
          quiz_award_id: string | null;
          quiz_award_amount: number | null;
          sellers_item_id: string | null;
          supplier_name: string | null;
          unit_code: string | null;
          variant_attributes: Json;
          variant_id: string | null;
          variant_name: string | null;
          vat_amount: number | null;
          vat_category_code: string | null;
          vat_rate: number | null;
        };
        Insert: {
          assurance_fee?: number | null;
          condition?: string | null;
          cost_price?: number | null;
          created_at?: string | null;
          fulfillment_data?: Json | null;
          has_assurance?: boolean | null;
          id?: string;
          image_url?: string | null;
          item_description?: string | null;
          line_extension_amount?: number | null;
          line_id?: number | null;
          name: string;
          order_id: string;
          price: number;
          product_id?: string | null;
          product_match_status?: string;
          quantity: number;
          quiz_award_id?: string | null;
          quiz_award_amount?: number | null;
          sellers_item_id?: string | null;
          supplier_name?: string | null;
          unit_code?: string | null;
          variant_attributes?: Json;
          variant_id?: string | null;
          variant_name?: string | null;
          vat_amount?: number | null;
          vat_category_code?: string | null;
          vat_rate?: number | null;
        };
        Update: {
          assurance_fee?: number | null;
          condition?: string | null;
          cost_price?: number | null;
          created_at?: string | null;
          fulfillment_data?: Json | null;
          has_assurance?: boolean | null;
          id?: string;
          image_url?: string | null;
          item_description?: string | null;
          line_extension_amount?: number | null;
          line_id?: number | null;
          name?: string;
          order_id?: string;
          price?: number;
          product_id?: string | null;
          product_match_status?: string;
          quantity?: number;
          quiz_award_id?: string | null;
          quiz_award_amount?: number | null;
          sellers_item_id?: string | null;
          supplier_name?: string | null;
          unit_code?: string | null;
          variant_attributes?: Json;
          variant_id?: string | null;
          variant_name?: string | null;
          vat_amount?: number | null;
          vat_category_code?: string | null;
          vat_rate?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'order_items_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_items_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'low_stock_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_items_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'order_items_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_items_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'secure_product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'order_items_quiz_award_id_fkey';
            columns: ['quiz_award_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_awards';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_items_variant_id_fkey';
            columns: ['variant_id'];
            isOneToOne: false;
            referencedRelation: 'product_variants';
            referencedColumns: ['id'];
          },
        ];
      };
      order_notification_outbox: {
        Row: {
          attempt_count: number;
          created_at: string;
          dispatch_started_at: string | null;
          event_sequence: number;
          event_type: string;
          fulfillment_cycle_id: string;
          id: string;
          last_error: string | null;
          locked_at: string | null;
          locked_by: string | null;
          max_attempts: number;
          merchant_id: string;
          metadata: Json;
          next_attempt_at: string | null;
          order_id: string;
          sent_at: string | null;
          skip_reason: string | null;
          skipped_at: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          created_at?: string;
          dispatch_started_at?: string | null;
          event_sequence?: number;
          event_type: string;
          fulfillment_cycle_id: string;
          id?: string;
          last_error?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          merchant_id: string;
          metadata?: Json;
          next_attempt_at?: string | null;
          order_id: string;
          sent_at?: string | null;
          skip_reason?: string | null;
          skipped_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          created_at?: string;
          dispatch_started_at?: string | null;
          event_sequence?: number;
          event_type?: string;
          fulfillment_cycle_id?: string;
          id?: string;
          last_error?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          merchant_id?: string;
          metadata?: Json;
          next_attempt_at?: string | null;
          order_id?: string;
          sent_at?: string | null;
          skip_reason?: string | null;
          skipped_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'order_notification_outbox_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'order_notification_outbox_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_notification_outbox_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'order_notification_outbox_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      order_payment_accounts: {
        Row: {
          account_name: string;
          account_number: string;
          assigned_at: string | null;
          bank_name: string;
          created_at: string | null;
          expires_at: string | null;
          id: string;
          order_id: string;
          payable_amount: number | null;
          provider: string;
        };
        Insert: {
          account_name: string;
          account_number: string;
          assigned_at?: string | null;
          bank_name: string;
          created_at?: string | null;
          expires_at?: string | null;
          id?: string;
          order_id: string;
          payable_amount?: number | null;
          provider?: string;
        };
        Update: {
          account_name?: string;
          account_number?: string;
          assigned_at?: string | null;
          bank_name?: string;
          created_at?: string | null;
          expires_at?: string | null;
          id?: string;
          order_id?: string;
          payable_amount?: number | null;
          provider?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'order_payment_accounts_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      order_reminders: {
        Row: {
          channel: string;
          id: string;
          order_id: string;
          payment_link: string | null;
          sent_at: string | null;
        };
        Insert: {
          channel: string;
          id?: string;
          order_id: string;
          payment_link?: string | null;
          sent_at?: string | null;
        };
        Update: {
          channel?: string;
          id?: string;
          order_id?: string;
          payment_link?: string | null;
          sent_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'fk_order';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_reminders_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      order_tax_subtotals: {
        Row: {
          created_at: string | null;
          exemption_reason: string | null;
          exemption_reason_code: string | null;
          id: string;
          order_id: string;
          tax_amount: number;
          taxable_amount: number;
          vat_category_code: string;
          vat_rate: number;
        };
        Insert: {
          created_at?: string | null;
          exemption_reason?: string | null;
          exemption_reason_code?: string | null;
          id?: string;
          order_id: string;
          tax_amount?: number;
          taxable_amount?: number;
          vat_category_code?: string;
          vat_rate?: number;
        };
        Update: {
          created_at?: string | null;
          exemption_reason?: string | null;
          exemption_reason_code?: string | null;
          id?: string;
          order_id?: string;
          tax_amount?: number;
          taxable_amount?: number;
          vat_category_code?: string;
          vat_rate?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'order_tax_subtotals_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      order_wallet_funding_events: {
        Row: {
          created_at: string;
          event_type: string;
          gateway_reference: string | null;
          id: string;
          intent_id: string | null;
          metadata: Json;
          order_id: string | null;
          transaction_id: string | null;
        };
        Insert: {
          created_at?: string;
          event_type: string;
          gateway_reference?: string | null;
          id?: string;
          intent_id?: string | null;
          metadata?: Json;
          order_id?: string | null;
          transaction_id?: string | null;
        };
        Update: {
          created_at?: string;
          event_type?: string;
          gateway_reference?: string | null;
          id?: string;
          intent_id?: string | null;
          metadata?: Json;
          order_id?: string | null;
          transaction_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'order_wallet_funding_events_intent_id_fkey';
            columns: ['intent_id'];
            isOneToOne: false;
            referencedRelation: 'order_wallet_funding_intents';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_wallet_funding_events_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_wallet_funding_events_transaction_id_fkey';
            columns: ['transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
        ];
      };
      order_wallet_funding_intent_payments: {
        Row: {
          amount: number;
          created_at: string;
          currency: string;
          gateway_fee: number;
          gateway_reference: string;
          id: string;
          intent_id: string;
          metadata: Json;
          order_payment_transaction_id: string | null;
          paid_at: string;
          provider: string;
          transaction_id: string;
          updated_at: string;
          wallet_credit_transaction_id: string | null;
          wallet_debit_transaction_id: string | null;
        };
        Insert: {
          amount: number;
          created_at?: string;
          currency?: string;
          gateway_fee?: number;
          gateway_reference: string;
          id?: string;
          intent_id: string;
          metadata?: Json;
          order_payment_transaction_id?: string | null;
          paid_at: string;
          provider?: string;
          transaction_id: string;
          updated_at?: string;
          wallet_credit_transaction_id?: string | null;
          wallet_debit_transaction_id?: string | null;
        };
        Update: {
          amount?: number;
          created_at?: string;
          currency?: string;
          gateway_fee?: number;
          gateway_reference?: string;
          id?: string;
          intent_id?: string;
          metadata?: Json;
          order_payment_transaction_id?: string | null;
          paid_at?: string;
          provider?: string;
          transaction_id?: string;
          updated_at?: string;
          wallet_credit_transaction_id?: string | null;
          wallet_debit_transaction_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'order_wallet_funding_intent_p_order_payment_transaction_id_fkey';
            columns: ['order_payment_transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_wallet_funding_intent_p_wallet_credit_transaction_id_fkey';
            columns: ['wallet_credit_transaction_id'];
            isOneToOne: false;
            referencedRelation: 'customer_wallet_transactions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_wallet_funding_intent_pa_wallet_debit_transaction_id_fkey';
            columns: ['wallet_debit_transaction_id'];
            isOneToOne: false;
            referencedRelation: 'customer_wallet_transactions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_wallet_funding_intent_payments_intent_id_fkey';
            columns: ['intent_id'];
            isOneToOne: false;
            referencedRelation: 'order_wallet_funding_intents';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_wallet_funding_intent_payments_transaction_id_fkey';
            columns: ['transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
        ];
      };
      order_wallet_funding_intents: {
        Row: {
          created_at: string;
          currency: string;
          customer_id: string;
          debited_amount: number;
          excess_amount: number;
          expected_amount: number;
          expires_at: string;
          funded_amount: number;
          id: string;
          idempotency_key: string;
          last_gateway_reference: string | null;
          last_transaction_id: string | null;
          merchant_id: string;
          metadata: Json;
          order_id: string;
          provider: string;
          status: string;
          target_order_amount: number;
          updated_at: string;
          wallet_balance_snapshot: number;
          wallet_payment_account_id: string;
        };
        Insert: {
          created_at?: string;
          currency?: string;
          customer_id: string;
          debited_amount?: number;
          excess_amount?: number;
          expected_amount: number;
          expires_at: string;
          funded_amount?: number;
          id?: string;
          idempotency_key: string;
          last_gateway_reference?: string | null;
          last_transaction_id?: string | null;
          merchant_id: string;
          metadata?: Json;
          order_id: string;
          provider?: string;
          status?: string;
          target_order_amount: number;
          updated_at?: string;
          wallet_balance_snapshot?: number;
          wallet_payment_account_id: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          customer_id?: string;
          debited_amount?: number;
          excess_amount?: number;
          expected_amount?: number;
          expires_at?: string;
          funded_amount?: number;
          id?: string;
          idempotency_key?: string;
          last_gateway_reference?: string | null;
          last_transaction_id?: string | null;
          merchant_id?: string;
          metadata?: Json;
          order_id?: string;
          provider?: string;
          status?: string;
          target_order_amount?: number;
          updated_at?: string;
          wallet_balance_snapshot?: number;
          wallet_payment_account_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'order_wallet_funding_intents_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'order_wallet_funding_intents_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_wallet_funding_intents_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_wallet_funding_intents_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'order_wallet_funding_intents_last_transaction_id_fkey';
            columns: ['last_transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_wallet_funding_intents_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'order_wallet_funding_intents_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_wallet_funding_intents_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'order_wallet_funding_intents_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_wallet_funding_intents_wallet_payment_account_id_fkey';
            columns: ['wallet_payment_account_id'];
            isOneToOne: false;
            referencedRelation: 'customer_wallet_payment_accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      orders: {
        Row: {
          ad_tracking: Json | null;
          amount_paid: number | null;
          branch_id: string | null;
          buyer_reference: string | null;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          checkout_idempotency_key: string | null;
          checkout_request_hash: string | null;
          checkout_request_hash_version: number | null;
          created_at: string | null;
          credit_notes: string | null;
          currency: string | null;
          customer_email: string | null;
          customer_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          delivered_at: string | null;
          delivery_method: string | null;
          airport_type: string | null;
          discount_amount: number | null;
          discount_code_id: string | null;
          exchange_rate: number | null;
          external_id: string | null;
          external_source: string | null;
          firs_csid: string | null;
          firs_irn: string | null;
          firs_qr_code: string | null;
          firs_submission_status: string | null;
          firs_submitted_at: string | null;
          fulfillment_details: Json | null;
          fulfillment_notification_cycle_id: string;
          fulfillment_type: string | null;
          gift_wrapping_fee: number;
          id: string;
          import_job_id: string | null;
          import_metadata: Json;
          imported_at: string | null;
          invoice_issue_date: string | null;
          invoice_note: string | null;
          invoice_pdf_url: string | null;
          invoice_type_code: string | null;
          is_credit_order: boolean | null;
          merchant_id: string;
          notes: string | null;
          order_number: string;
          original_currency: string | null;
          original_total: number | null;
          paid_transaction_id: string | null;
          payment_due_date: string | null;
          payment_method: string | null;
          payment_status: string;
          payment_terms: string | null;
          payout_id: string | null;
          payout_status: string | null;
          purchase_order_reference: string | null;
          recorded_by_user_id: string | null;
          selected_quote_id: string | null;
          self_fulfillment_data: Json | null;
          shipment_booking_lock_token: string | null;
          shipment_booking_started_at: string | null;
          shipment_id: string | null;
          shipped_at: string | null;
          shipping_address: Json | null;
          shipping_fee: number | null;
          shipping_pickup_details: Json | null;
          shipping_provider: string | null;
          shipping_rate_id: string | null;
          shipping_rate_name: string | null;
          shipping_status: string;
          source: string | null;
          subtotal: number | null;
          tax_amount: number | null;
          tax_basis: string | null;
          tax_exclusive_amount: number | null;
          tax_inclusive_amount: number | null;
          tax_point_date: string | null;
          total: number;
          tracking_number: string | null;
          tracking_token: string;
          transaction_date: string | null;
          updated_at: string | null;
          wallet_amount_used: number | null;
          wallet_transaction_id: string | null;
        };
        Insert: {
          ad_tracking?: Json | null;
          amount_paid?: number | null;
          branch_id?: string | null;
          buyer_reference?: string | null;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          checkout_idempotency_key?: string | null;
          checkout_request_hash?: string | null;
          checkout_request_hash_version?: number | null;
          created_at?: string | null;
          credit_notes?: string | null;
          currency?: string | null;
          customer_email?: string | null;
          customer_id?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          delivered_at?: string | null;
          delivery_method?: string | null;
          airport_type?: string | null;
          discount_amount?: number | null;
          discount_code_id?: string | null;
          exchange_rate?: number | null;
          external_id?: string | null;
          external_source?: string | null;
          firs_csid?: string | null;
          firs_irn?: string | null;
          firs_qr_code?: string | null;
          firs_submission_status?: string | null;
          firs_submitted_at?: string | null;
          fulfillment_details?: Json | null;
          fulfillment_notification_cycle_id?: string;
          fulfillment_type?: string | null;
          gift_wrapping_fee?: number;
          id?: string;
          import_job_id?: string | null;
          import_metadata?: Json;
          imported_at?: string | null;
          invoice_issue_date?: string | null;
          invoice_note?: string | null;
          invoice_pdf_url?: string | null;
          invoice_type_code?: string | null;
          is_credit_order?: boolean | null;
          merchant_id: string;
          notes?: string | null;
          order_number: string;
          original_currency?: string | null;
          original_total?: number | null;
          paid_transaction_id?: string | null;
          payment_due_date?: string | null;
          payment_method?: string | null;
          payment_status?: string;
          payment_terms?: string | null;
          payout_id?: string | null;
          payout_status?: string | null;
          purchase_order_reference?: string | null;
          recorded_by_user_id?: string | null;
          selected_quote_id?: string | null;
          self_fulfillment_data?: Json | null;
          shipment_booking_lock_token?: string | null;
          shipment_booking_started_at?: string | null;
          shipment_id?: string | null;
          shipped_at?: string | null;
          shipping_address?: Json | null;
          shipping_fee?: number | null;
          shipping_pickup_details?: Json | null;
          shipping_provider?: string | null;
          shipping_rate_id?: string | null;
          shipping_rate_name?: string | null;
          shipping_status?: string;
          source?: string | null;
          subtotal?: number | null;
          tax_amount?: number | null;
          tax_basis?: string | null;
          tax_exclusive_amount?: number | null;
          tax_inclusive_amount?: number | null;
          tax_point_date?: string | null;
          total: number;
          tracking_number?: string | null;
          tracking_token?: string;
          transaction_date?: string | null;
          updated_at?: string | null;
          wallet_amount_used?: number | null;
          wallet_transaction_id?: string | null;
        };
        Update: {
          ad_tracking?: Json | null;
          amount_paid?: number | null;
          branch_id?: string | null;
          buyer_reference?: string | null;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          checkout_idempotency_key?: string | null;
          checkout_request_hash?: string | null;
          checkout_request_hash_version?: number | null;
          created_at?: string | null;
          credit_notes?: string | null;
          currency?: string | null;
          customer_email?: string | null;
          customer_id?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          delivered_at?: string | null;
          delivery_method?: string | null;
          airport_type?: string | null;
          discount_amount?: number | null;
          discount_code_id?: string | null;
          exchange_rate?: number | null;
          external_id?: string | null;
          external_source?: string | null;
          firs_csid?: string | null;
          firs_irn?: string | null;
          firs_qr_code?: string | null;
          firs_submission_status?: string | null;
          firs_submitted_at?: string | null;
          fulfillment_details?: Json | null;
          fulfillment_notification_cycle_id?: string;
          fulfillment_type?: string | null;
          gift_wrapping_fee?: number;
          id?: string;
          import_job_id?: string | null;
          import_metadata?: Json;
          imported_at?: string | null;
          invoice_issue_date?: string | null;
          invoice_note?: string | null;
          invoice_pdf_url?: string | null;
          invoice_type_code?: string | null;
          is_credit_order?: boolean | null;
          merchant_id?: string;
          notes?: string | null;
          order_number?: string;
          original_currency?: string | null;
          original_total?: number | null;
          paid_transaction_id?: string | null;
          payment_due_date?: string | null;
          payment_method?: string | null;
          payment_status?: string;
          payment_terms?: string | null;
          payout_id?: string | null;
          payout_status?: string | null;
          purchase_order_reference?: string | null;
          recorded_by_user_id?: string | null;
          selected_quote_id?: string | null;
          self_fulfillment_data?: Json | null;
          shipment_booking_lock_token?: string | null;
          shipment_booking_started_at?: string | null;
          shipment_id?: string | null;
          shipped_at?: string | null;
          shipping_address?: Json | null;
          shipping_fee?: number | null;
          shipping_pickup_details?: Json | null;
          shipping_provider?: string | null;
          shipping_rate_id?: string | null;
          shipping_rate_name?: string | null;
          shipping_status?: string;
          source?: string | null;
          subtotal?: number | null;
          tax_amount?: number | null;
          tax_basis?: string | null;
          tax_exclusive_amount?: number | null;
          tax_inclusive_amount?: number | null;
          tax_point_date?: string | null;
          total?: number;
          tracking_number?: string | null;
          tracking_token?: string;
          transaction_date?: string | null;
          updated_at?: string | null;
          wallet_amount_used?: number | null;
          wallet_transaction_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'orders_branch_id_fkey';
            columns: ['branch_id'];
            isOneToOne: false;
            referencedRelation: 'branches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_customer_id_fkey1';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'orders_customer_id_fkey1';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_customer_id_fkey1';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_customer_id_fkey1';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'orders_discount_code_id_fkey';
            columns: ['discount_code_id'];
            isOneToOne: false;
            referencedRelation: 'discount_codes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_import_job_id_fkey';
            columns: ['import_job_id'];
            isOneToOne: false;
            referencedRelation: 'import_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_merchant_id_fkey1';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'orders_merchant_id_fkey1';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_merchant_id_fkey1';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'orders_paid_transaction_id_fkey';
            columns: ['paid_transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_payout_id_fkey';
            columns: ['payout_id'];
            isOneToOne: false;
            referencedRelation: 'payouts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_selected_quote_id_fkey';
            columns: ['selected_quote_id'];
            isOneToOne: false;
            referencedRelation: 'shipping_quotes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_shipment_id_fkey';
            columns: ['shipment_id'];
            isOneToOne: false;
            referencedRelation: 'shipments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_shipping_rate_id_fkey';
            columns: ['shipping_rate_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_shipping_rates';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_wallet_transaction_id_fkey';
            columns: ['wallet_transaction_id'];
            isOneToOne: false;
            referencedRelation: 'customer_wallet_transactions';
            referencedColumns: ['id'];
          },
        ];
      };
      page_config_history: {
        Row: {
          config: Json;
          created_at: string | null;
          id: string;
          page_config_id: string;
          version_note: string | null;
        };
        Insert: {
          config: Json;
          created_at?: string | null;
          id?: string;
          page_config_id: string;
          version_note?: string | null;
        };
        Update: {
          config?: Json;
          created_at?: string | null;
          id?: string;
          page_config_id?: string;
          version_note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'page_config_history_page_config_id_fkey';
            columns: ['page_config_id'];
            isOneToOne: false;
            referencedRelation: 'page_configs';
            referencedColumns: ['id'];
          },
        ];
      };
      page_configs: {
        Row: {
          created_at: string | null;
          draft_config: Json | null;
          draft_seo: Json | null;
          draft_setup_settings: Json | null;
          draft_store_settings: Json | null;
          id: string;
          is_published: boolean | null;
          merchant_id: string;
          page_name: string;
          page_slug: string;
          published_at: string | null;
          published_config: Json | null;
          published_seo: Json | null;
          published_setup_settings: Json | null;
          published_store_settings: Json | null;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          draft_config?: Json | null;
          draft_seo?: Json | null;
          draft_setup_settings?: Json | null;
          draft_store_settings?: Json | null;
          id?: string;
          is_published?: boolean | null;
          merchant_id: string;
          page_name: string;
          page_slug: string;
          published_at?: string | null;
          published_config?: Json | null;
          published_seo?: Json | null;
          published_setup_settings?: Json | null;
          published_store_settings?: Json | null;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          draft_config?: Json | null;
          draft_seo?: Json | null;
          draft_setup_settings?: Json | null;
          draft_store_settings?: Json | null;
          id?: string;
          is_published?: boolean | null;
          merchant_id?: string;
          page_name?: string;
          page_slug?: string;
          published_at?: string | null;
          published_config?: Json | null;
          published_seo?: Json | null;
          published_setup_settings?: Json | null;
          published_store_settings?: Json | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'page_configs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'page_configs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'page_configs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      payment_side_effects: {
        Row: {
          attempts: number;
          claim_token: string;
          claimed_at: string;
          claimed_by: string;
          completed_at: string | null;
          error: string | null;
          order_id: string;
          result: Json | null;
          status: string;
          step: string;
          transaction_id: string;
        };
        Insert: {
          attempts?: number;
          claim_token?: string;
          claimed_at?: string;
          claimed_by: string;
          completed_at?: string | null;
          error?: string | null;
          order_id: string;
          result?: Json | null;
          status?: string;
          step: string;
          transaction_id: string;
        };
        Update: {
          attempts?: number;
          claim_token?: string;
          claimed_at?: string;
          claimed_by?: string;
          completed_at?: string | null;
          error?: string | null;
          order_id?: string;
          result?: Json | null;
          status?: string;
          step?: string;
          transaction_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_side_effects_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_side_effects_transaction_id_fkey';
            columns: ['transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
        ];
      };
      payout_requests: {
        Row: {
          amount: number;
          bank_account_name: string;
          bank_account_number: string;
          bank_code: string;
          bank_name: string | null;
          completed_at: string | null;
          created_at: string | null;
          currency: string;
          failure_reason: string | null;
          id: string;
          korapay_reference: string | null;
          korapay_response: Json | null;
          merchant_id: string;
          processed_at: string | null;
          requested_at: string | null;
          retry_count: number | null;
          status: string;
          updated_at: string | null;
        };
        Insert: {
          amount: number;
          bank_account_name: string;
          bank_account_number: string;
          bank_code: string;
          bank_name?: string | null;
          completed_at?: string | null;
          created_at?: string | null;
          currency: string;
          failure_reason?: string | null;
          id?: string;
          korapay_reference?: string | null;
          korapay_response?: Json | null;
          merchant_id: string;
          processed_at?: string | null;
          requested_at?: string | null;
          retry_count?: number | null;
          status?: string;
          updated_at?: string | null;
        };
        Update: {
          amount?: number;
          bank_account_name?: string;
          bank_account_number?: string;
          bank_code?: string;
          bank_name?: string | null;
          completed_at?: string | null;
          created_at?: string | null;
          currency?: string;
          failure_reason?: string | null;
          id?: string;
          korapay_reference?: string | null;
          korapay_response?: Json | null;
          merchant_id?: string;
          processed_at?: string | null;
          requested_at?: string | null;
          retry_count?: number | null;
          status?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'payout_requests_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'payout_requests_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payout_requests_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      payouts: {
        Row: {
          amount: number;
          created_at: string | null;
          currency: string | null;
          id: string;
          merchant_id: string;
          payout_mode: string | null;
          processed_at: string | null;
          reference: string | null;
          status: string | null;
        };
        Insert: {
          amount: number;
          created_at?: string | null;
          currency?: string | null;
          id?: string;
          merchant_id: string;
          payout_mode?: string | null;
          processed_at?: string | null;
          reference?: string | null;
          status?: string | null;
        };
        Update: {
          amount?: number;
          created_at?: string | null;
          currency?: string | null;
          id?: string;
          merchant_id?: string;
          payout_mode?: string | null;
          processed_at?: string | null;
          reference?: string | null;
          status?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'payouts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'payouts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payouts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      pending_import_uploads: {
        Row: {
          claimed_at: string | null;
          client_upload_id: string;
          content_type: string | null;
          created_at: string;
          created_by: string;
          entity_type: string;
          expires_at: string;
          file_size_bytes: number | null;
          id: string;
          merchant_id: string;
          original_filename: string;
          source_platform: string;
          storage_path: string;
        };
        Insert: {
          claimed_at?: string | null;
          client_upload_id: string;
          content_type?: string | null;
          created_at?: string;
          created_by: string;
          entity_type: string;
          expires_at: string;
          file_size_bytes?: number | null;
          id?: string;
          merchant_id: string;
          original_filename: string;
          source_platform: string;
          storage_path: string;
        };
        Update: {
          claimed_at?: string | null;
          client_upload_id?: string;
          content_type?: string | null;
          created_at?: string;
          created_by?: string;
          entity_type?: string;
          expires_at?: string;
          file_size_bytes?: number | null;
          id?: string;
          merchant_id?: string;
          original_filename?: string;
          source_platform?: string;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pending_import_uploads_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'pending_import_uploads_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pending_import_uploads_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      petrock_feedback_events: {
        Row: {
          body_bytes: number;
          body_keys: string[];
          body_sha256: string;
          content_type: string | null;
          id: string;
          lookup_id: string;
          query_keys: string[];
          received_at: string;
        };
        Insert: {
          body_bytes: number;
          body_keys?: string[];
          body_sha256: string;
          content_type?: string | null;
          id?: string;
          lookup_id: string;
          query_keys?: string[];
          received_at?: string;
        };
        Update: {
          body_bytes?: number;
          body_keys?: string[];
          body_sha256?: string;
          content_type?: string | null;
          id?: string;
          lookup_id?: string;
          query_keys?: string[];
          received_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'petrock_feedback_events_lookup_id_fkey';
            columns: ['lookup_id'];
            isOneToOne: false;
            referencedRelation: 'imei_lookup_customer_status';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'petrock_feedback_events_lookup_id_fkey';
            columns: ['lookup_id'];
            isOneToOne: false;
            referencedRelation: 'imei_lookups';
            referencedColumns: ['id'];
          },
        ];
      };
      petrock_order_events: {
        Row: {
          actor: string;
          created_at: string;
          event_type: string;
          from_status: string | null;
          id: string;
          metadata: Json;
          order_id: string;
          to_status: string | null;
        };
        Insert: {
          actor?: string;
          created_at?: string;
          event_type: string;
          from_status?: string | null;
          id?: string;
          metadata?: Json;
          order_id: string;
          to_status?: string | null;
        };
        Update: {
          actor?: string;
          created_at?: string;
          event_type?: string;
          from_status?: string | null;
          id?: string;
          metadata?: Json;
          order_id?: string;
          to_status?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'petrock_order_events_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'petrock_order_customer_status';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'petrock_order_events_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'petrock_orders';
            referencedColumns: ['id'];
          },
        ];
      };
      petrock_orders: {
        Row: {
          amount_ngn: number | null;
          amount_usdt: number | null;
          carrier: string | null;
          completed_at: string | null;
          cost_usd: number | null;
          created_at: string;
          customer_id: string;
          customer_message: string | null;
          device_model: string | null;
          eligibility_checks_completed: string[];
          eligibility_evidence: Json;
          eligibility_next_check: string | null;
          email_notification_claim_token: string | null;
          email_notification_claim_until: string | null;
          email_notified_at: string | null;
          failure_reason: string | null;
          feedback_token_hash: string | null;
          fx_rate_used: number | null;
          id: string;
          identifier_ciphertext: string | null;
          identifier_hash: string;
          in_app_notified_at: string | null;
          merchant_id: string;
          next_poll_at: string | null;
          paid_at: string | null;
          payment_currency: string | null;
          provider_attempt_started_at: string | null;
          provider_order_id: string | null;
          provider_reference_id: string | null;
          provider_status: string | null;
          push_notification_claim_token: string | null;
          push_notification_claim_until: string | null;
          push_notified_at: string | null;
          reconcile_attempts: number;
          reconcile_lease_token: string | null;
          reconcile_lease_until: string | null;
          refund_policy: string | null;
          refunded_at: string | null;
          remediation_product_id: string | null;
          source_lookup_id: string;
          status: string;
          status_segment: string | null;
          submitted_at: string | null;
          success_rate: number | null;
          turnaround: string | null;
          updated_at: string;
        };
        Insert: {
          amount_ngn?: number | null;
          amount_usdt?: number | null;
          carrier?: string | null;
          completed_at?: string | null;
          cost_usd?: number | null;
          created_at?: string;
          customer_id: string;
          customer_message?: string | null;
          device_model?: string | null;
          eligibility_checks_completed?: string[];
          eligibility_evidence?: Json;
          eligibility_next_check?: string | null;
          email_notification_claim_token?: string | null;
          email_notification_claim_until?: string | null;
          email_notified_at?: string | null;
          failure_reason?: string | null;
          feedback_token_hash?: string | null;
          fx_rate_used?: number | null;
          id?: string;
          identifier_ciphertext?: string | null;
          identifier_hash: string;
          in_app_notified_at?: string | null;
          merchant_id: string;
          next_poll_at?: string | null;
          paid_at?: string | null;
          payment_currency?: string | null;
          provider_attempt_started_at?: string | null;
          provider_order_id?: string | null;
          provider_reference_id?: string | null;
          provider_status?: string | null;
          push_notification_claim_token?: string | null;
          push_notification_claim_until?: string | null;
          push_notified_at?: string | null;
          reconcile_attempts?: number;
          reconcile_lease_token?: string | null;
          reconcile_lease_until?: string | null;
          refund_policy?: string | null;
          refunded_at?: string | null;
          remediation_product_id?: string | null;
          source_lookup_id: string;
          status?: string;
          status_segment?: string | null;
          submitted_at?: string | null;
          success_rate?: number | null;
          turnaround?: string | null;
          updated_at?: string;
        };
        Update: {
          amount_ngn?: number | null;
          amount_usdt?: number | null;
          carrier?: string | null;
          completed_at?: string | null;
          cost_usd?: number | null;
          created_at?: string;
          customer_id?: string;
          customer_message?: string | null;
          device_model?: string | null;
          eligibility_checks_completed?: string[];
          eligibility_evidence?: Json;
          eligibility_next_check?: string | null;
          email_notification_claim_token?: string | null;
          email_notification_claim_until?: string | null;
          email_notified_at?: string | null;
          failure_reason?: string | null;
          feedback_token_hash?: string | null;
          fx_rate_used?: number | null;
          id?: string;
          identifier_ciphertext?: string | null;
          identifier_hash?: string;
          in_app_notified_at?: string | null;
          merchant_id?: string;
          next_poll_at?: string | null;
          paid_at?: string | null;
          payment_currency?: string | null;
          provider_attempt_started_at?: string | null;
          provider_order_id?: string | null;
          provider_reference_id?: string | null;
          provider_status?: string | null;
          push_notification_claim_token?: string | null;
          push_notification_claim_until?: string | null;
          push_notified_at?: string | null;
          reconcile_attempts?: number;
          reconcile_lease_token?: string | null;
          reconcile_lease_until?: string | null;
          refund_policy?: string | null;
          refunded_at?: string | null;
          remediation_product_id?: string | null;
          source_lookup_id?: string;
          status?: string;
          status_segment?: string | null;
          submitted_at?: string | null;
          success_rate?: number | null;
          turnaround?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'petrock_orders_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'petrock_orders_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'petrock_orders_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'petrock_orders_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'petrock_orders_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'petrock_orders_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'petrock_orders_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'petrock_orders_remediation_product_id_fkey';
            columns: ['remediation_product_id'];
            isOneToOne: false;
            referencedRelation: 'petrock_remediation_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'petrock_orders_source_lookup_id_fkey';
            columns: ['source_lookup_id'];
            isOneToOne: false;
            referencedRelation: 'imei_lookup_customer_status';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'petrock_orders_source_lookup_id_fkey';
            columns: ['source_lookup_id'];
            isOneToOne: false;
            referencedRelation: 'imei_lookups';
            referencedColumns: ['id'];
          },
        ];
      };
      petrock_remediation_products: {
        Row: {
          carrier: string | null;
          catalog_synced_at: string | null;
          category_id: string | null;
          cost_usd: number | null;
          created_at: string;
          excluded_reason: string | null;
          fixture_verified: boolean;
          id: string;
          is_active: boolean;
          launch_carrier: boolean;
          manual_disabled: boolean;
          model_scope: Json;
          order_field_name: string | null;
          parser_version: number;
          price_ngn: number | null;
          price_usdt: number | null;
          provider_product_id: string;
          raw_name: string;
          refund_policy: string;
          region: string | null;
          review_status: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status_segment: string;
          success_rate: number | null;
          turnaround: string | null;
          updated_at: string;
        };
        Insert: {
          carrier?: string | null;
          catalog_synced_at?: string | null;
          category_id?: string | null;
          cost_usd?: number | null;
          created_at?: string;
          excluded_reason?: string | null;
          fixture_verified?: boolean;
          id?: string;
          is_active?: boolean;
          launch_carrier?: boolean;
          manual_disabled?: boolean;
          model_scope?: Json;
          order_field_name?: string | null;
          parser_version?: number;
          price_ngn?: number | null;
          price_usdt?: number | null;
          provider_product_id: string;
          raw_name: string;
          refund_policy: string;
          region?: string | null;
          review_status?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status_segment?: string;
          success_rate?: number | null;
          turnaround?: string | null;
          updated_at?: string;
        };
        Update: {
          carrier?: string | null;
          catalog_synced_at?: string | null;
          category_id?: string | null;
          cost_usd?: number | null;
          created_at?: string;
          excluded_reason?: string | null;
          fixture_verified?: boolean;
          id?: string;
          is_active?: boolean;
          launch_carrier?: boolean;
          manual_disabled?: boolean;
          model_scope?: Json;
          order_field_name?: string | null;
          parser_version?: number;
          price_ngn?: number | null;
          price_usdt?: number | null;
          provider_product_id?: string;
          raw_name?: string;
          refund_policy?: string;
          region?: string | null;
          review_status?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status_segment?: string;
          success_rate?: number | null;
          turnaround?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      platform_admin_memberships: {
        Row: {
          created_at: string;
          granted_at: string;
          granted_by: string | null;
          id: string;
          reason: string;
          revoked_at: string | null;
          revoked_by: string | null;
          role: Database['public']['Enums']['platform_admin_role'];
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          granted_at?: string;
          granted_by?: string | null;
          id?: string;
          reason: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
          role: Database['public']['Enums']['platform_admin_role'];
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          granted_at?: string;
          granted_by?: string | null;
          id?: string;
          reason?: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
          role?: Database['public']['Enums']['platform_admin_role'];
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      platform_audit_events: {
        Row: {
          action: string;
          actor_user_id: string;
          changed_fields: string[];
          id: string;
          metadata: Json;
          occurred_at: string;
          resource_id: string;
          resource_type: string;
        };
        Insert: {
          action: string;
          actor_user_id: string;
          changed_fields?: string[];
          id?: string;
          metadata?: Json;
          occurred_at?: string;
          resource_id: string;
          resource_type: string;
        };
        Update: {
          action?: string;
          actor_user_id?: string;
          changed_fields?: string[];
          id?: string;
          metadata?: Json;
          occurred_at?: string;
          resource_id?: string;
          resource_type?: string;
        };
        Relationships: [];
      };
      platform_events: {
        Row: {
          created_at: string | null;
          event_data: Json | null;
          event_id: string | null;
          event_timestamp: string | null;
          event_type: string;
          id: string;
          ip_address: string | null;
          merchant_id: string | null;
          page_url: string | null;
          referrer: string | null;
          session_id: string | null;
          user_agent: string | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          event_data?: Json | null;
          event_id?: string | null;
          event_timestamp?: string | null;
          event_type: string;
          id?: string;
          ip_address?: string | null;
          merchant_id?: string | null;
          page_url?: string | null;
          referrer?: string | null;
          session_id?: string | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          event_data?: Json | null;
          event_id?: string | null;
          event_timestamp?: string | null;
          event_type?: string;
          id?: string;
          ip_address?: string | null;
          merchant_id?: string | null;
          page_url?: string | null;
          referrer?: string | null;
          session_id?: string | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'platform_events_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'platform_events_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'platform_events_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      platform_settings: {
        Row: {
          created_at: string | null;
          enable_analytics_export: boolean | null;
          enable_custom_domains: boolean | null;
          enable_merchant_signups: boolean | null;
          facebook_capi_token: string | null;
          facebook_pixel_id: string | null;
          ga4_api_secret: string | null;
          google_analytics_id: string | null;
          id: string;
          maintenance_message: string | null;
          maintenance_mode: boolean | null;
          payment_processor_fee_flat: number | null;
          payment_processor_fee_percentage: number | null;
          platform_fee_flat: number | null;
          platform_fee_percentage: number | null;
          platform_logo_url: string | null;
          platform_name: string | null;
          singleton_key: boolean | null;
          snapchat_capi_token: string | null;
          snapchat_pixel_id: string | null;
          support_email: string | null;
          support_phone: string | null;
          tiktok_access_token: string | null;
          tiktok_pixel_id: string | null;
          twitter_pixel_id: string | null;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          enable_analytics_export?: boolean | null;
          enable_custom_domains?: boolean | null;
          enable_merchant_signups?: boolean | null;
          facebook_capi_token?: string | null;
          facebook_pixel_id?: string | null;
          ga4_api_secret?: string | null;
          google_analytics_id?: string | null;
          id?: string;
          maintenance_message?: string | null;
          maintenance_mode?: boolean | null;
          payment_processor_fee_flat?: number | null;
          payment_processor_fee_percentage?: number | null;
          platform_fee_flat?: number | null;
          platform_fee_percentage?: number | null;
          platform_logo_url?: string | null;
          platform_name?: string | null;
          singleton_key?: boolean | null;
          snapchat_capi_token?: string | null;
          snapchat_pixel_id?: string | null;
          support_email?: string | null;
          support_phone?: string | null;
          tiktok_access_token?: string | null;
          tiktok_pixel_id?: string | null;
          twitter_pixel_id?: string | null;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          enable_analytics_export?: boolean | null;
          enable_custom_domains?: boolean | null;
          enable_merchant_signups?: boolean | null;
          facebook_capi_token?: string | null;
          facebook_pixel_id?: string | null;
          ga4_api_secret?: string | null;
          google_analytics_id?: string | null;
          id?: string;
          maintenance_message?: string | null;
          maintenance_mode?: boolean | null;
          payment_processor_fee_flat?: number | null;
          payment_processor_fee_percentage?: number | null;
          platform_fee_flat?: number | null;
          platform_fee_percentage?: number | null;
          platform_logo_url?: string | null;
          platform_name?: string | null;
          singleton_key?: boolean | null;
          snapchat_capi_token?: string | null;
          snapchat_pixel_id?: string | null;
          support_email?: string | null;
          support_phone?: string | null;
          tiktok_access_token?: string | null;
          tiktok_pixel_id?: string | null;
          twitter_pixel_id?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      points_transactions: {
        Row: {
          balance_after: number;
          created_at: string | null;
          customer_id: string;
          description: string | null;
          expired: boolean | null;
          expires_at: string | null;
          id: string;
          merchant_id: string;
          metadata: Json | null;
          points: number;
          source: string;
          source_id: string | null;
          type: string;
        };
        Insert: {
          balance_after: number;
          created_at?: string | null;
          customer_id: string;
          description?: string | null;
          expired?: boolean | null;
          expires_at?: string | null;
          id?: string;
          merchant_id: string;
          metadata?: Json | null;
          points: number;
          source: string;
          source_id?: string | null;
          type: string;
        };
        Update: {
          balance_after?: number;
          created_at?: string | null;
          customer_id?: string;
          description?: string | null;
          expired?: boolean | null;
          expires_at?: string | null;
          id?: string;
          merchant_id?: string;
          metadata?: Json | null;
          points?: number;
          source?: string;
          source_id?: string | null;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'points_transactions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'points_transactions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'points_transactions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'points_transactions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'points_transactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'points_transactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'points_transactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      product_categories: {
        Row: {
          category_id: string;
          created_at: string | null;
          id: string;
          is_primary: boolean | null;
          product_id: string;
        };
        Insert: {
          category_id: string;
          created_at?: string | null;
          id?: string;
          is_primary?: boolean | null;
          product_id: string;
        };
        Update: {
          category_id?: string;
          created_at?: string | null;
          id?: string;
          is_primary?: boolean | null;
          product_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'product_categories_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_categories_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'low_stock_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_categories_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'product_categories_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_categories_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'secure_product_performance';
            referencedColumns: ['product_id'];
          },
        ];
      };
      product_category_cross_tenant_archive: {
        Row: {
          archived_at: string;
          category_id: string;
          category_merchant_id: string;
          is_primary: boolean | null;
          membership_created_at: string | null;
          membership_id: string;
          product_id: string;
          product_merchant_id: string;
        };
        Insert: {
          archived_at?: string;
          category_id: string;
          category_merchant_id: string;
          is_primary?: boolean | null;
          membership_created_at?: string | null;
          membership_id: string;
          product_id: string;
          product_merchant_id: string;
        };
        Update: {
          archived_at?: string;
          category_id?: string;
          category_merchant_id?: string;
          is_primary?: boolean | null;
          membership_created_at?: string | null;
          membership_id?: string;
          product_id?: string;
          product_merchant_id?: string;
        };
        Relationships: [];
      };
      product_feed_images: {
        Row: {
          created_at: string;
          failure_reason: string | null;
          id: string;
          is_primary: boolean;
          last_checked_at: string | null;
          merchant_id: string;
          position: number;
          product_id: string;
          source_url: string;
          status: string;
          updated_at: string;
          variant_id: string | null;
          verified_at: string | null;
          verified_format: string | null;
          verified_url: string | null;
        };
        Insert: {
          created_at?: string;
          failure_reason?: string | null;
          id?: string;
          is_primary?: boolean;
          last_checked_at?: string | null;
          merchant_id: string;
          position?: number;
          product_id: string;
          source_url: string;
          status?: string;
          updated_at?: string;
          variant_id?: string | null;
          verified_at?: string | null;
          verified_format?: string | null;
          verified_url?: string | null;
        };
        Update: {
          created_at?: string;
          failure_reason?: string | null;
          id?: string;
          is_primary?: boolean;
          last_checked_at?: string | null;
          merchant_id?: string;
          position?: number;
          product_id?: string;
          source_url?: string;
          status?: string;
          updated_at?: string;
          variant_id?: string | null;
          verified_at?: string | null;
          verified_format?: string | null;
          verified_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'product_feed_images_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'product_feed_images_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_feed_images_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'product_feed_images_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'low_stock_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_feed_images_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'product_feed_images_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_feed_images_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'secure_product_performance';
            referencedColumns: ['product_id'];
          },
        ];
      };
      product_key_specs: {
        Row: {
          android_version: number | null;
          announced_date: string | null;
          available_colors: string | null;
          battery_mah: number | null;
          battery_removable: boolean | null;
          battery_score: number | null;
          bluetooth_version: string | null;
          build_materials: string | null;
          camera_score: number | null;
          card_slot_type: string | null;
          charging_watt: number | null;
          chipset: string | null;
          cpu_cores: string | null;
          created_at: string | null;
          dimensions_mm: string | null;
          display_peak_brightness: number | null;
          display_ppi: number | null;
          display_protection: string | null;
          display_resolution: string | null;
          display_type: string | null;
          fingerprint_type: string | null;
          front_camera_features: string | null;
          front_camera_mp: number | null;
          front_camera_video: string | null;
          gaming_score: number | null;
          gpu: string | null;
          has_5g: boolean | null;
          has_card_slot: boolean | null;
          has_dual_camera: boolean | null;
          has_fm_radio: boolean | null;
          has_headphone_jack: boolean | null;
          has_nfc: boolean | null;
          has_ois: boolean | null;
          has_quad_camera: boolean | null;
          has_reverse_charging: boolean | null;
          has_stereo_speakers: boolean | null;
          has_triple_camera: boolean | null;
          has_usb_otg: boolean | null;
          has_wireless_charging: boolean | null;
          id: string;
          ip_rating: string | null;
          main_camera_mp: number | null;
          model_numbers: string | null;
          network_technology: string | null;
          positioning: string | null;
          product_id: string;
          ram_gb: number | null;
          rear_camera_features: string | null;
          rear_camera_video: string | null;
          recommended_for: string[] | null;
          refresh_rate_hz: number | null;
          release_date: string | null;
          screen_size_inches: number | null;
          sensors: string | null;
          sim_type: string | null;
          storage_gb: number | null;
          usb_type: string | null;
          weight_g: number | null;
          wifi_bands: string | null;
          wireless_charging_watt: number | null;
        };
        Insert: {
          android_version?: number | null;
          announced_date?: string | null;
          available_colors?: string | null;
          battery_mah?: number | null;
          battery_removable?: boolean | null;
          battery_score?: number | null;
          bluetooth_version?: string | null;
          build_materials?: string | null;
          camera_score?: number | null;
          card_slot_type?: string | null;
          charging_watt?: number | null;
          chipset?: string | null;
          cpu_cores?: string | null;
          created_at?: string | null;
          dimensions_mm?: string | null;
          display_peak_brightness?: number | null;
          display_ppi?: number | null;
          display_protection?: string | null;
          display_resolution?: string | null;
          display_type?: string | null;
          fingerprint_type?: string | null;
          front_camera_features?: string | null;
          front_camera_mp?: number | null;
          front_camera_video?: string | null;
          gaming_score?: number | null;
          gpu?: string | null;
          has_5g?: boolean | null;
          has_card_slot?: boolean | null;
          has_dual_camera?: boolean | null;
          has_fm_radio?: boolean | null;
          has_headphone_jack?: boolean | null;
          has_nfc?: boolean | null;
          has_ois?: boolean | null;
          has_quad_camera?: boolean | null;
          has_reverse_charging?: boolean | null;
          has_stereo_speakers?: boolean | null;
          has_triple_camera?: boolean | null;
          has_usb_otg?: boolean | null;
          has_wireless_charging?: boolean | null;
          id?: string;
          ip_rating?: string | null;
          main_camera_mp?: number | null;
          model_numbers?: string | null;
          network_technology?: string | null;
          positioning?: string | null;
          product_id: string;
          ram_gb?: number | null;
          rear_camera_features?: string | null;
          rear_camera_video?: string | null;
          recommended_for?: string[] | null;
          refresh_rate_hz?: number | null;
          release_date?: string | null;
          screen_size_inches?: number | null;
          sensors?: string | null;
          sim_type?: string | null;
          storage_gb?: number | null;
          usb_type?: string | null;
          weight_g?: number | null;
          wifi_bands?: string | null;
          wireless_charging_watt?: number | null;
        };
        Update: {
          android_version?: number | null;
          announced_date?: string | null;
          available_colors?: string | null;
          battery_mah?: number | null;
          battery_removable?: boolean | null;
          battery_score?: number | null;
          bluetooth_version?: string | null;
          build_materials?: string | null;
          camera_score?: number | null;
          card_slot_type?: string | null;
          charging_watt?: number | null;
          chipset?: string | null;
          cpu_cores?: string | null;
          created_at?: string | null;
          dimensions_mm?: string | null;
          display_peak_brightness?: number | null;
          display_ppi?: number | null;
          display_protection?: string | null;
          display_resolution?: string | null;
          display_type?: string | null;
          fingerprint_type?: string | null;
          front_camera_features?: string | null;
          front_camera_mp?: number | null;
          front_camera_video?: string | null;
          gaming_score?: number | null;
          gpu?: string | null;
          has_5g?: boolean | null;
          has_card_slot?: boolean | null;
          has_dual_camera?: boolean | null;
          has_fm_radio?: boolean | null;
          has_headphone_jack?: boolean | null;
          has_nfc?: boolean | null;
          has_ois?: boolean | null;
          has_quad_camera?: boolean | null;
          has_reverse_charging?: boolean | null;
          has_stereo_speakers?: boolean | null;
          has_triple_camera?: boolean | null;
          has_usb_otg?: boolean | null;
          has_wireless_charging?: boolean | null;
          id?: string;
          ip_rating?: string | null;
          main_camera_mp?: number | null;
          model_numbers?: string | null;
          network_technology?: string | null;
          positioning?: string | null;
          product_id?: string;
          ram_gb?: number | null;
          rear_camera_features?: string | null;
          rear_camera_video?: string | null;
          recommended_for?: string[] | null;
          refresh_rate_hz?: number | null;
          release_date?: string | null;
          screen_size_inches?: number | null;
          sensors?: string | null;
          sim_type?: string | null;
          storage_gb?: number | null;
          usb_type?: string | null;
          weight_g?: number | null;
          wifi_bands?: string | null;
          wireless_charging_watt?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'product_key_specs_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: true;
            referencedRelation: 'low_stock_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_key_specs_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: true;
            referencedRelation: 'product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'product_key_specs_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: true;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_key_specs_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: true;
            referencedRelation: 'secure_product_performance';
            referencedColumns: ['product_id'];
          },
        ];
      };
      product_offer_migration_archive: {
        Row: {
          archive_reason: string;
          archived_at: string;
          compare_at_price: number | null;
          condition: string;
          condition_notes: string | null;
          created_at: string | null;
          grade: string | null;
          images: Json | null;
          merchant_id: string;
          offer_id: string;
          price: number;
          product_id: string;
          source_migration: string;
          status: string | null;
          stock_quantity: number;
          updated_at: string | null;
        };
        Insert: {
          archive_reason: string;
          archived_at?: string;
          compare_at_price?: number | null;
          condition: string;
          condition_notes?: string | null;
          created_at?: string | null;
          grade?: string | null;
          images?: Json | null;
          merchant_id: string;
          offer_id: string;
          price: number;
          product_id: string;
          source_migration?: string;
          status?: string | null;
          stock_quantity: number;
          updated_at?: string | null;
        };
        Update: {
          archive_reason?: string;
          archived_at?: string;
          compare_at_price?: number | null;
          condition?: string;
          condition_notes?: string | null;
          created_at?: string | null;
          grade?: string | null;
          images?: Json | null;
          merchant_id?: string;
          offer_id?: string;
          price?: number;
          product_id?: string;
          source_migration?: string;
          status?: string | null;
          stock_quantity?: number;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      product_offers: {
        Row: {
          compare_at_price: number | null;
          condition: string;
          condition_notes: string | null;
          created_at: string | null;
          grade: string | null;
          id: string;
          images: Json | null;
          merchant_id: string;
          price: number;
          product_id: string;
          status: string | null;
          stock_quantity: number;
          updated_at: string | null;
        };
        Insert: {
          compare_at_price?: number | null;
          condition: string;
          condition_notes?: string | null;
          created_at?: string | null;
          grade?: string | null;
          id?: string;
          images?: Json | null;
          merchant_id: string;
          price: number;
          product_id: string;
          status?: string | null;
          stock_quantity?: number;
          updated_at?: string | null;
        };
        Update: {
          compare_at_price?: number | null;
          condition?: string;
          condition_notes?: string | null;
          created_at?: string | null;
          grade?: string | null;
          id?: string;
          images?: Json | null;
          merchant_id?: string;
          price?: number;
          product_id?: string;
          status?: string | null;
          stock_quantity?: number;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'product_offers_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'product_offers_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_offers_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'product_offers_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'low_stock_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_offers_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'product_offers_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_offers_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'secure_product_performance';
            referencedColumns: ['product_id'];
          },
        ];
      };
      product_reviews: {
        Row: {
          body: string | null;
          created_at: string | null;
          customer_email: string;
          customer_name: string | null;
          helpful_count: number | null;
          id: string;
          merchant_id: string;
          merchant_response: string | null;
          merchant_response_at: string | null;
          order_id: string | null;
          product_id: string;
          rating: number;
          status: string | null;
          title: string | null;
          updated_at: string | null;
          verified_purchase: boolean | null;
        };
        Insert: {
          body?: string | null;
          created_at?: string | null;
          customer_email: string;
          customer_name?: string | null;
          helpful_count?: number | null;
          id?: string;
          merchant_id: string;
          merchant_response?: string | null;
          merchant_response_at?: string | null;
          order_id?: string | null;
          product_id: string;
          rating: number;
          status?: string | null;
          title?: string | null;
          updated_at?: string | null;
          verified_purchase?: boolean | null;
        };
        Update: {
          body?: string | null;
          created_at?: string | null;
          customer_email?: string;
          customer_name?: string | null;
          helpful_count?: number | null;
          id?: string;
          merchant_id?: string;
          merchant_response?: string | null;
          merchant_response_at?: string | null;
          order_id?: string | null;
          product_id?: string;
          rating?: number;
          status?: string | null;
          title?: string | null;
          updated_at?: string | null;
          verified_purchase?: boolean | null;
        };
        Relationships: [
          {
            foreignKeyName: 'product_reviews_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'product_reviews_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_reviews_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'product_reviews_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_reviews_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'low_stock_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_reviews_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'product_reviews_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_reviews_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'secure_product_performance';
            referencedColumns: ['product_id'];
          },
        ];
      };
      product_variant_migration_archive: {
        Row: {
          archive_reason: string;
          archived_at: string;
          canonical_condition: string;
          canonical_variant_id: string;
          condition: string | null;
          merchant_id: string;
          product_id: string;
          row_data: Json;
          source_migration: string;
          variant_id: string;
          variant_key: string | null;
        };
        Insert: {
          archive_reason: string;
          archived_at?: string;
          canonical_condition: string;
          canonical_variant_id: string;
          condition?: string | null;
          merchant_id: string;
          product_id: string;
          row_data: Json;
          source_migration?: string;
          variant_id: string;
          variant_key?: string | null;
        };
        Update: {
          archive_reason?: string;
          archived_at?: string;
          canonical_condition?: string;
          canonical_variant_id?: string;
          condition?: string | null;
          merchant_id?: string;
          product_id?: string;
          row_data?: Json;
          source_migration?: string;
          variant_id?: string;
          variant_key?: string | null;
        };
        Relationships: [];
      };
      product_variants: {
        Row: {
          attributes: Json;
          condition: string | null;
          cost_price: number | null;
          created_at: string | null;
          id: string;
          images: Json | null;
          inventory_tracking_policy: string;
          is_inventory_anchor: boolean;
          merchant_id: string;
          price_override: number | null;
          primary_image: string | null;
          product_id: string;
          sku: string | null;
          stock_quantity: number;
          updated_at: string | null;
          variant_key: string | null;
        };
        Insert: {
          attributes?: Json;
          condition?: string | null;
          cost_price?: number | null;
          created_at?: string | null;
          id?: string;
          images?: Json | null;
          inventory_tracking_policy?: string;
          is_inventory_anchor?: boolean;
          merchant_id: string;
          price_override?: number | null;
          primary_image?: string | null;
          product_id: string;
          sku?: string | null;
          stock_quantity?: number;
          updated_at?: string | null;
          variant_key?: string | null;
        };
        Update: {
          attributes?: Json;
          condition?: string | null;
          cost_price?: number | null;
          created_at?: string | null;
          id?: string;
          images?: Json | null;
          inventory_tracking_policy?: string;
          is_inventory_anchor?: boolean;
          merchant_id?: string;
          price_override?: number | null;
          primary_image?: string | null;
          product_id?: string;
          sku?: string | null;
          stock_quantity?: number;
          updated_at?: string | null;
          variant_key?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'product_variants_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'product_variants_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_variants_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'product_variants_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'low_stock_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_variants_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'product_variants_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_variants_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'secure_product_performance';
            referencedColumns: ['product_id'];
          },
        ];
      };
      products: {
        Row: {
          available_conditions: string[];
          average_rating: number;
          brand: string | null;
          brand_id: string | null;
          canonical_url: string | null;
          category: string | null;
          category_id: string | null;
          color: string | null;
          color_images: Json | null;
          commodity_code: string | null;
          compare_at_price: number | null;
          condition: string | null;
          condition_detail: string | null;
          content_embedding: string | null;
          cost_price: number | null;
          created_at: string | null;
          default_variant_id: string | null;
          description: string | null;
          description_digital_source_type: string | null;
          description_provenance_sha256: string | null;
          dimensions: Json | null;
          external_id: string | null;
          external_source: string | null;
          faqs: Json | null;
          fulfillment_details: Json | null;
          fulfillment_fields: Json | null;
          google_product_category: string | null;
          gtin: string | null;
          has_condition_offers: boolean | null;
          has_variants: boolean | null;
          id: string;
          image_hint: string | null;
          images: Json | null;
          import_job_id: string | null;
          imported_at: string | null;
          inventory_anchor_variant_id: string | null;
          inventory_tracking_policy: string;
          is_parent: boolean | null;
          keywords: string[] | null;
          last_price_sync: string | null;
          low_stock_threshold: number | null;
          manage_stock: boolean | null;
          max_variant_price: number | null;
          merchant_id: string;
          meta_description: string | null;
          meta_title: string | null;
          metadata: Json | null;
          migration_status: string;
          min_variant_price: number | null;
          mpn: string | null;
          name: string;
          offers: Json | null;
          parent_product_id: string | null;
          price: number;
          review_count: number;
          schema_markup: Json | null;
          search_doc_vector: unknown;
          search_identify_vector: unknown;
          search_name_compact: string | null;
          search_name_norm: string | null;
          search_vector: unknown;
          sku: string | null;
          slug: string | null;
          specifications: Json | null;
          status: string | null;
          stock: number | null;
          stock_quantity: number | null;
          tax_code: string | null;
          tax_exempt: boolean | null;
          taxable: boolean | null;
          unit_code: string | null;
          updated_at: string | null;
          variant_attributes: Json | null;
          variant_model: string;
          vat_category_code: string | null;
          vat_rate: number | null;
          view_count: number;
          weight_unit: string | null;
          weight_value: number | null;
        };
        Insert: {
          available_conditions?: string[];
          average_rating?: number;
          brand?: string | null;
          brand_id?: string | null;
          canonical_url?: string | null;
          category?: string | null;
          category_id?: string | null;
          color?: string | null;
          color_images?: Json | null;
          commodity_code?: string | null;
          compare_at_price?: number | null;
          condition?: string | null;
          condition_detail?: string | null;
          content_embedding?: string | null;
          cost_price?: number | null;
          created_at?: string | null;
          default_variant_id?: string | null;
          description?: string | null;
          description_digital_source_type?: string | null;
          description_provenance_sha256?: string | null;
          dimensions?: Json | null;
          external_id?: string | null;
          external_source?: string | null;
          faqs?: Json | null;
          fulfillment_details?: Json | null;
          fulfillment_fields?: Json | null;
          google_product_category?: string | null;
          gtin?: string | null;
          has_condition_offers?: boolean | null;
          has_variants?: boolean | null;
          id?: string;
          image_hint?: string | null;
          images?: Json | null;
          import_job_id?: string | null;
          imported_at?: string | null;
          inventory_anchor_variant_id?: string | null;
          inventory_tracking_policy?: string;
          is_parent?: boolean | null;
          keywords?: string[] | null;
          last_price_sync?: string | null;
          low_stock_threshold?: number | null;
          manage_stock?: boolean | null;
          max_variant_price?: number | null;
          merchant_id: string;
          meta_description?: string | null;
          meta_title?: string | null;
          metadata?: Json | null;
          migration_status?: string;
          min_variant_price?: number | null;
          mpn?: string | null;
          name: string;
          offers?: Json | null;
          parent_product_id?: string | null;
          price: number;
          review_count?: number;
          schema_markup?: Json | null;
          search_doc_vector?: unknown;
          search_identify_vector?: unknown;
          search_name_compact?: string | null;
          search_name_norm?: string | null;
          search_vector?: unknown;
          sku?: string | null;
          slug?: string | null;
          specifications?: Json | null;
          status?: string | null;
          stock?: number | null;
          stock_quantity?: number | null;
          tax_code?: string | null;
          tax_exempt?: boolean | null;
          taxable?: boolean | null;
          unit_code?: string | null;
          updated_at?: string | null;
          variant_attributes?: Json | null;
          variant_model?: string;
          vat_category_code?: string | null;
          vat_rate?: number | null;
          view_count?: number;
          weight_unit?: string | null;
          weight_value?: number | null;
        };
        Update: {
          available_conditions?: string[];
          average_rating?: number;
          brand?: string | null;
          brand_id?: string | null;
          canonical_url?: string | null;
          category?: string | null;
          category_id?: string | null;
          color?: string | null;
          color_images?: Json | null;
          commodity_code?: string | null;
          compare_at_price?: number | null;
          condition?: string | null;
          condition_detail?: string | null;
          content_embedding?: string | null;
          cost_price?: number | null;
          created_at?: string | null;
          default_variant_id?: string | null;
          description?: string | null;
          description_digital_source_type?: string | null;
          description_provenance_sha256?: string | null;
          dimensions?: Json | null;
          external_id?: string | null;
          external_source?: string | null;
          faqs?: Json | null;
          fulfillment_details?: Json | null;
          fulfillment_fields?: Json | null;
          google_product_category?: string | null;
          gtin?: string | null;
          has_condition_offers?: boolean | null;
          has_variants?: boolean | null;
          id?: string;
          image_hint?: string | null;
          images?: Json | null;
          import_job_id?: string | null;
          imported_at?: string | null;
          inventory_anchor_variant_id?: string | null;
          inventory_tracking_policy?: string;
          is_parent?: boolean | null;
          keywords?: string[] | null;
          last_price_sync?: string | null;
          low_stock_threshold?: number | null;
          manage_stock?: boolean | null;
          max_variant_price?: number | null;
          merchant_id?: string;
          meta_description?: string | null;
          meta_title?: string | null;
          metadata?: Json | null;
          migration_status?: string;
          min_variant_price?: number | null;
          mpn?: string | null;
          name?: string;
          offers?: Json | null;
          parent_product_id?: string | null;
          price?: number;
          review_count?: number;
          schema_markup?: Json | null;
          search_doc_vector?: unknown;
          search_identify_vector?: unknown;
          search_name_compact?: string | null;
          search_name_norm?: string | null;
          search_vector?: unknown;
          sku?: string | null;
          slug?: string | null;
          specifications?: Json | null;
          status?: string | null;
          stock?: number | null;
          stock_quantity?: number | null;
          tax_code?: string | null;
          tax_exempt?: boolean | null;
          taxable?: boolean | null;
          unit_code?: string | null;
          updated_at?: string | null;
          variant_attributes?: Json | null;
          variant_model?: string;
          vat_category_code?: string | null;
          vat_rate?: number | null;
          view_count?: number;
          weight_unit?: string | null;
          weight_value?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'products_brand_id_fkey';
            columns: ['brand_id'];
            isOneToOne: false;
            referencedRelation: 'brands';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_default_variant_id_fkey';
            columns: ['default_variant_id'];
            isOneToOne: false;
            referencedRelation: 'product_variants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_import_job_id_fkey';
            columns: ['import_job_id'];
            isOneToOne: false;
            referencedRelation: 'import_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'products_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'products_parent_product_id_fkey';
            columns: ['parent_product_id'];
            isOneToOne: false;
            referencedRelation: 'low_stock_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_parent_product_id_fkey';
            columns: ['parent_product_id'];
            isOneToOne: false;
            referencedRelation: 'product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'products_parent_product_id_fkey';
            columns: ['parent_product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_parent_product_id_fkey';
            columns: ['parent_product_id'];
            isOneToOne: false;
            referencedRelation: 'secure_product_performance';
            referencedColumns: ['product_id'];
          },
        ];
      };
      push_notification_attempts: {
        Row: {
          app_type: string;
          body: string;
          channel: string | null;
          created_at: string;
          errors: Json;
          failed_count: number;
          id: string;
          merchant_id: string | null;
          notification_type: string | null;
          payload: Json;
          sent_count: number;
          status: string;
          title: string;
          token_count: number;
          user_id: string | null;
        };
        Insert: {
          app_type?: string;
          body: string;
          channel?: string | null;
          created_at?: string;
          errors?: Json;
          failed_count?: number;
          id?: string;
          merchant_id?: string | null;
          notification_type?: string | null;
          payload?: Json;
          sent_count?: number;
          status: string;
          title: string;
          token_count?: number;
          user_id?: string | null;
        };
        Update: {
          app_type?: string;
          body?: string;
          channel?: string | null;
          created_at?: string;
          errors?: Json;
          failed_count?: number;
          id?: string;
          merchant_id?: string | null;
          notification_type?: string | null;
          payload?: Json;
          sent_count?: number;
          status?: string;
          title?: string;
          token_count?: number;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'push_notification_attempts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'push_notification_attempts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'push_notification_attempts_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      push_notification_tickets: {
        Row: {
          app_type: string;
          channel: string | null;
          checked_at: string | null;
          created_at: string;
          error_message: string | null;
          error_type: string | null;
          id: string;
          merchant_id: string | null;
          notification_type: string | null;
          push_token: string;
          status: string;
          ticket_id: string;
          user_id: string | null;
        };
        Insert: {
          app_type?: string;
          channel?: string | null;
          checked_at?: string | null;
          created_at?: string;
          error_message?: string | null;
          error_type?: string | null;
          id?: string;
          merchant_id?: string | null;
          notification_type?: string | null;
          push_token: string;
          status?: string;
          ticket_id: string;
          user_id?: string | null;
        };
        Update: {
          app_type?: string;
          channel?: string | null;
          checked_at?: string | null;
          created_at?: string;
          error_message?: string | null;
          error_type?: string | null;
          id?: string;
          merchant_id?: string | null;
          notification_type?: string | null;
          push_token?: string;
          status?: string;
          ticket_id?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'push_notification_tickets_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'push_notification_tickets_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'push_notification_tickets_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      push_registration_diagnostics: {
        Row: {
          app_type: string;
          app_version: string | null;
          attempt_id: string | null;
          build_number: string | null;
          created_at: string | null;
          device_name: string | null;
          id: string;
          merchant_id: string | null;
          message: string | null;
          metadata: Json | null;
          outcome: string;
          phase: string;
          platform: string | null;
          session_id: string | null;
          user_id: string | null;
        };
        Insert: {
          app_type: string;
          app_version?: string | null;
          attempt_id?: string | null;
          build_number?: string | null;
          created_at?: string | null;
          device_name?: string | null;
          id?: string;
          merchant_id?: string | null;
          message?: string | null;
          metadata?: Json | null;
          outcome: string;
          phase: string;
          platform?: string | null;
          session_id?: string | null;
          user_id?: string | null;
        };
        Update: {
          app_type?: string;
          app_version?: string | null;
          attempt_id?: string | null;
          build_number?: string | null;
          created_at?: string | null;
          device_name?: string | null;
          id?: string;
          merchant_id?: string | null;
          message?: string | null;
          metadata?: Json | null;
          outcome?: string;
          phase?: string;
          platform?: string | null;
          session_id?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      push_tokens: {
        Row: {
          app_type: string;
          build_number: number | null;
          created_at: string | null;
          deactivated_at: string | null;
          deactivation_reason: string | null;
          device_name: string | null;
          id: string;
          is_active: boolean | null;
          last_update_push_at: string | null;
          last_used_at: string | null;
          merchant_id: string;
          platform: string;
          shipment_update_capability: number | null;
          token: string;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          app_type?: string;
          build_number?: number | null;
          created_at?: string | null;
          deactivated_at?: string | null;
          deactivation_reason?: string | null;
          device_name?: string | null;
          id?: string;
          is_active?: boolean | null;
          last_update_push_at?: string | null;
          last_used_at?: string | null;
          merchant_id: string;
          platform: string;
          shipment_update_capability?: number | null;
          token: string;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          app_type?: string;
          build_number?: number | null;
          created_at?: string | null;
          deactivated_at?: string | null;
          deactivation_reason?: string | null;
          device_name?: string | null;
          id?: string;
          is_active?: boolean | null;
          last_update_push_at?: string | null;
          last_used_at?: string | null;
          merchant_id?: string;
          platform?: string;
          shipment_update_capability?: number | null;
          token?: string;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'push_tokens_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'push_tokens_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'push_tokens_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      quiz_attempt_answers: {
        Row: {
          answer_payload: Json;
          answered_at: string;
          answered_in_ms: number | null;
          attempt_question_id: string;
          id: string;
          score_delta: number;
        };
        Insert: {
          answer_payload?: Json;
          answered_at?: string;
          answered_in_ms?: number | null;
          attempt_question_id: string;
          id?: string;
          score_delta?: number;
        };
        Update: {
          answer_payload?: Json;
          answered_at?: string;
          answered_in_ms?: number | null;
          attempt_question_id?: string;
          id?: string;
          score_delta?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'quiz_attempt_answers_attempt_question_id_fkey';
            columns: ['attempt_question_id'];
            isOneToOne: true;
            referencedRelation: 'quiz_attempt_questions';
            referencedColumns: ['id'];
          },
        ];
      };
      quiz_attempt_devices: {
        Row: {
          allowed: boolean;
          attempt_id: string;
          created_at: string;
          device_hash: string;
          event_id: string;
        };
        Insert: {
          allowed?: boolean;
          attempt_id: string;
          created_at?: string;
          device_hash: string;
          event_id: string;
        };
        Update: {
          allowed?: boolean;
          attempt_id?: string;
          created_at?: string;
          device_hash?: string;
          event_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'quiz_attempt_devices_attempt_id_fkey';
            columns: ['attempt_id'];
            isOneToOne: true;
            referencedRelation: 'quiz_attempts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_attempt_devices_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_events';
            referencedColumns: ['id'];
          },
        ];
      };
      quiz_attempt_questions: {
        Row: {
          attempt_id: string;
          created_at: string;
          id: string;
          issued_at: string | null;
          option_order: Json;
          position: number;
          slot_id: string;
          time_limit_ms: number | null;
          variant_id: string;
        };
        Insert: {
          attempt_id: string;
          created_at?: string;
          id?: string;
          issued_at?: string | null;
          option_order?: Json;
          position: number;
          slot_id: string;
          time_limit_ms?: number | null;
          variant_id: string;
        };
        Update: {
          attempt_id?: string;
          created_at?: string;
          id?: string;
          issued_at?: string | null;
          option_order?: Json;
          position?: number;
          slot_id?: string;
          time_limit_ms?: number | null;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'quiz_attempt_questions_attempt_id_fkey';
            columns: ['attempt_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_attempts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_attempt_questions_slot_id_fkey';
            columns: ['slot_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_question_slots';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_attempt_questions_variant_id_fkey';
            columns: ['variant_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_question_variants';
            referencedColumns: ['id'];
          },
        ];
      };
      quiz_attempt_signal_flags: {
        Row: {
          attempt_id: string;
          created_at: string;
          details: Json;
          id: string;
          severity: string;
          signal_key: string;
        };
        Insert: {
          attempt_id: string;
          created_at?: string;
          details?: Json;
          id?: string;
          severity?: string;
          signal_key: string;
        };
        Update: {
          attempt_id?: string;
          created_at?: string;
          details?: Json;
          id?: string;
          severity?: string;
          signal_key?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'quiz_attempt_signal_flags_attempt_id_fkey';
            columns: ['attempt_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_attempts';
            referencedColumns: ['id'];
          },
        ];
      };
      quiz_attempts: {
        Row: {
          app_version: string | null;
          attempt_number: number;
          created_at: string;
          customer_id: string;
          event_id: string;
          id: string;
          integrity_tier: string;
          leaderboard_username: string | null;
          platform: string | null;
          route_proof_id: string | null;
          rules_version: string | null;
          score: number;
          start_request_id: string | null;
          started_at: string;
          status: string;
          submitted_at: string | null;
          terms_accepted_at: string | null;
        };
        Insert: {
          app_version?: string | null;
          attempt_number?: number;
          created_at?: string;
          customer_id: string;
          event_id: string;
          id?: string;
          integrity_tier?: string;
          leaderboard_username?: string | null;
          platform?: string | null;
          route_proof_id?: string | null;
          rules_version?: string | null;
          score?: number;
          start_request_id?: string | null;
          started_at?: string;
          status?: string;
          submitted_at?: string | null;
          terms_accepted_at?: string | null;
        };
        Update: {
          app_version?: string | null;
          attempt_number?: number;
          created_at?: string;
          customer_id?: string;
          event_id?: string;
          id?: string;
          integrity_tier?: string;
          leaderboard_username?: string | null;
          platform?: string | null;
          route_proof_id?: string | null;
          rules_version?: string | null;
          score?: number;
          start_request_id?: string | null;
          started_at?: string;
          status?: string;
          submitted_at?: string | null;
          terms_accepted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'quiz_attempts_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'quiz_attempts_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_attempts_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_attempts_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'quiz_attempts_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_events';
            referencedColumns: ['id'];
          },
        ];
      };
      quiz_awards: {
        Row: {
          amount: number | null;
          approved_at: string | null;
          attempt_id: string | null;
          award_source: string | null;
          award_type: string;
          claim_expires_at: string | null;
          claimed_at: string | null;
          condition: string | null;
          created_at: string;
          currency: string;
          customer_id: string;
          event_id: string;
          expired_at: string | null;
          id: string;
          product_id: string | null;
          reserved_order_id: string | null;
          reserved_order_item_id: string | null;
          route_proof_id: string | null;
          status: string;
          variant_id: string | null;
        };
        Insert: {
          amount?: number | null;
          approved_at?: string | null;
          attempt_id?: string | null;
          award_source?: string | null;
          award_type: string;
          claim_expires_at?: string | null;
          claimed_at?: string | null;
          condition?: string | null;
          created_at?: string;
          currency?: string;
          customer_id: string;
          event_id: string;
          expired_at?: string | null;
          id?: string;
          product_id?: string | null;
          reserved_order_id?: string | null;
          reserved_order_item_id?: string | null;
          route_proof_id?: string | null;
          status?: string;
          variant_id?: string | null;
        };
        Update: {
          amount?: number | null;
          approved_at?: string | null;
          attempt_id?: string | null;
          award_source?: string | null;
          award_type?: string;
          claim_expires_at?: string | null;
          claimed_at?: string | null;
          condition?: string | null;
          created_at?: string;
          currency?: string;
          customer_id?: string;
          event_id?: string;
          expired_at?: string | null;
          id?: string;
          product_id?: string | null;
          reserved_order_id?: string | null;
          reserved_order_item_id?: string | null;
          route_proof_id?: string | null;
          status?: string;
          variant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'quiz_awards_attempt_id_fkey';
            columns: ['attempt_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_attempts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_awards_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'quiz_awards_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_awards_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_awards_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'quiz_awards_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_awards_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'low_stock_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_awards_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'quiz_awards_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_awards_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'secure_product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'quiz_awards_reserved_order_id_fkey';
            columns: ['reserved_order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_awards_reserved_order_item_id_fkey';
            columns: ['reserved_order_item_id'];
            isOneToOne: false;
            referencedRelation: 'order_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_awards_variant_id_fkey';
            columns: ['variant_id'];
            isOneToOne: false;
            referencedRelation: 'product_variants';
            referencedColumns: ['id'];
          },
        ];
      };
      quiz_compliance_tracker: {
        Row: {
          approval_comment: string | null;
          approved_at: string | null;
          created_at: string;
          details: Json;
          evidence_link: string | null;
          item: string;
          source_reference_checked_at: string | null;
          updated_at: string;
          verification_status: string | null;
        };
        Insert: {
          approval_comment?: string | null;
          approved_at?: string | null;
          created_at?: string;
          details?: Json;
          evidence_link?: string | null;
          item: string;
          source_reference_checked_at?: string | null;
          updated_at?: string;
          verification_status?: string | null;
        };
        Update: {
          approval_comment?: string | null;
          approved_at?: string | null;
          created_at?: string;
          details?: Json;
          evidence_link?: string | null;
          item?: string;
          source_reference_checked_at?: string | null;
          updated_at?: string;
          verification_status?: string | null;
        };
        Relationships: [];
      };
      quiz_deadline_clock_health_v2: {
        Row: {
          consecutive_failures: number;
          last_failure_at: string | null;
          last_failure_count: number;
          last_run_at: string;
          last_success_at: string | null;
          last_summary: Json;
          singleton: boolean;
          updated_at: string;
        };
        Insert: {
          consecutive_failures?: number;
          last_failure_at?: string | null;
          last_failure_count?: number;
          last_run_at: string;
          last_success_at?: string | null;
          last_summary?: Json;
          singleton?: boolean;
          updated_at?: string;
        };
        Update: {
          consecutive_failures?: number;
          last_failure_at?: string | null;
          last_failure_count?: number;
          last_run_at?: string;
          last_success_at?: string | null;
          last_summary?: Json;
          singleton?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      quiz_runtime_control_v2: {
        Row: {
          production_approved: boolean;
          production_phase: boolean;
          singleton: boolean;
          updated_at: string;
        };
        Insert: {
          production_approved?: boolean;
          production_phase?: boolean;
          singleton?: boolean;
          updated_at?: string;
        };
        Update: {
          production_approved?: boolean;
          production_phase?: boolean;
          singleton?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      quiz_event_testers: {
        Row: {
          created_at: string;
          event_id: string;
          id: string;
          invited_by: string | null;
          merchant_id: string;
          revoked_at: string | null;
          revoked_by: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          event_id: string;
          id?: string;
          invited_by?: string | null;
          merchant_id: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          event_id?: string;
          id?: string;
          invited_by?: string | null;
          merchant_id?: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'quiz_event_testers_event_merchant_fkey';
            columns: ['event_id', 'merchant_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_events';
            referencedColumns: ['id', 'merchant_id'];
          },
          {
            foreignKeyName: 'quiz_event_testers_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'quiz_event_testers_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_event_testers_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      quiz_events: {
        Row: {
          attempts_terminalized_at: string | null;
          award_finalized_at: string | null;
          claim_window_seconds: number | null;
          compliance_flags: Json;
          compliance_verified: boolean;
          contract_version: number;
          created_at: string;
          ends_at: string | null;
          finalization_error_code: string | null;
          finalization_state: string;
          id: string;
          live_window_seconds: number;
          max_attempts: number;
          maximum_play_seconds: number;
          merchant_id: string;
          mode: string;
          nlrc_permit_ref: string | null;
          published_odds: Json;
          question_count: number;
          regulatory_basis: string | null;
          regulatory_evidence_ref: string | null;
          regulatory_jurisdiction: string | null;
          results_published_at: string | null;
          rules_version: string | null;
          settings: Json;
          slug: string;
          starts_at: string | null;
          status: string;
          time_per_question_seconds: number;
          time_zone: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          attempts_terminalized_at?: string | null;
          award_finalized_at?: string | null;
          claim_window_seconds?: number | null;
          compliance_flags?: Json;
          compliance_verified?: boolean;
          contract_version?: number;
          created_at?: string;
          ends_at?: string | null;
          finalization_error_code?: string | null;
          finalization_state?: string;
          id?: string;
          live_window_seconds?: number;
          max_attempts?: number;
          maximum_play_seconds?: number;
          merchant_id: string;
          mode?: string;
          nlrc_permit_ref?: string | null;
          published_odds?: Json;
          question_count?: number;
          regulatory_basis?: string | null;
          regulatory_evidence_ref?: string | null;
          regulatory_jurisdiction?: string | null;
          results_published_at?: string | null;
          rules_version?: string | null;
          settings?: Json;
          slug: string;
          starts_at?: string | null;
          status?: string;
          time_per_question_seconds?: number;
          time_zone?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          attempts_terminalized_at?: string | null;
          award_finalized_at?: string | null;
          claim_window_seconds?: number | null;
          compliance_flags?: Json;
          compliance_verified?: boolean;
          contract_version?: number;
          created_at?: string;
          ends_at?: string | null;
          finalization_error_code?: string | null;
          finalization_state?: string;
          id?: string;
          live_window_seconds?: number;
          max_attempts?: number;
          maximum_play_seconds?: number;
          merchant_id?: string;
          mode?: string;
          nlrc_permit_ref?: string | null;
          published_odds?: Json;
          question_count?: number;
          regulatory_basis?: string | null;
          regulatory_evidence_ref?: string | null;
          regulatory_jurisdiction?: string | null;
          results_published_at?: string | null;
          rules_version?: string | null;
          settings?: Json;
          slug?: string;
          starts_at?: string | null;
          status?: string;
          time_per_question_seconds?: number;
          time_zone?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'quiz_events_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'quiz_events_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_events_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      quiz_integrity_challenges: {
        Row: {
          attempt_id: string;
          challenge_type: string;
          completed_at: string | null;
          created_at: string;
          expires_at: string | null;
          id: string;
          proof_payload: Json;
          status: string;
        };
        Insert: {
          attempt_id: string;
          challenge_type: string;
          completed_at?: string | null;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          proof_payload?: Json;
          status?: string;
        };
        Update: {
          attempt_id?: string;
          challenge_type?: string;
          completed_at?: string | null;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          proof_payload?: Json;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'quiz_integrity_challenges_attempt_id_fkey';
            columns: ['attempt_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_attempts';
            referencedColumns: ['id'];
          },
        ];
      };
      quiz_leaderboard_identity_suppressions: {
        Row: {
          attempt_id: string;
          customer_id: string;
          event_id: string;
          id: string;
          merchant_id: string;
          reason: string;
          suppressed_at: string;
          suppressed_by: string;
        };
        Insert: {
          attempt_id: string;
          customer_id: string;
          event_id: string;
          id?: string;
          merchant_id: string;
          reason: string;
          suppressed_at?: string;
          suppressed_by: string;
        };
        Update: {
          attempt_id?: string;
          customer_id?: string;
          event_id?: string;
          id?: string;
          merchant_id?: string;
          reason?: string;
          suppressed_at?: string;
          suppressed_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'quiz_leaderboard_identity_suppressions_attempt_id_fkey';
            columns: ['attempt_id'];
            isOneToOne: true;
            referencedRelation: 'quiz_attempts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_leaderboard_identity_suppressions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'quiz_leaderboard_identity_suppressions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_leaderboard_identity_suppressions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_leaderboard_identity_suppressions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'quiz_leaderboard_identity_suppressions_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_leaderboard_identity_suppressions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'quiz_leaderboard_identity_suppressions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_leaderboard_identity_suppressions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      quiz_prize_reservations: {
        Row: {
          award_id: string | null;
          condition: string | null;
          created_at: string;
          event_id: string;
          id: string;
          inventory_kind: string;
          inventory_unit_id: string | null;
          merchant_id: string;
          product_id: string;
          quantity: number;
          release_reason: string | null;
          released_at: string | null;
          reserved_at: string;
          state: string;
          transferred_at: string | null;
          updated_at: string;
          variant_id: string | null;
        };
        Insert: {
          award_id?: string | null;
          condition?: string | null;
          created_at?: string;
          event_id: string;
          id?: string;
          inventory_kind: string;
          inventory_unit_id?: string | null;
          merchant_id: string;
          product_id: string;
          quantity?: number;
          release_reason?: string | null;
          released_at?: string | null;
          reserved_at?: string;
          state?: string;
          transferred_at?: string | null;
          updated_at?: string;
          variant_id?: string | null;
        };
        Update: {
          award_id?: string | null;
          condition?: string | null;
          created_at?: string;
          event_id?: string;
          id?: string;
          inventory_kind?: string;
          inventory_unit_id?: string | null;
          merchant_id?: string;
          product_id?: string;
          quantity?: number;
          release_reason?: string | null;
          released_at?: string | null;
          reserved_at?: string;
          state?: string;
          transferred_at?: string | null;
          updated_at?: string;
          variant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'quiz_prize_reservations_award_id_fkey';
            columns: ['award_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_awards';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_prize_reservations_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: true;
            referencedRelation: 'quiz_events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_prize_reservations_event_merchant_fkey';
            columns: ['event_id', 'merchant_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_events';
            referencedColumns: ['id', 'merchant_id'];
          },
          {
            foreignKeyName: 'quiz_prize_reservations_inventory_unit_id_fkey';
            columns: ['inventory_unit_id'];
            isOneToOne: false;
            referencedRelation: 'variant_inventory';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_prize_reservations_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'quiz_prize_reservations_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_prize_reservations_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'quiz_prize_reservations_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'low_stock_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_prize_reservations_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'quiz_prize_reservations_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_prize_reservations_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'secure_product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'quiz_prize_reservations_variant_id_fkey';
            columns: ['variant_id'];
            isOneToOne: false;
            referencedRelation: 'product_variants';
            referencedColumns: ['id'];
          },
        ];
      };
      quiz_proof_validation_failures: {
        Row: {
          action: string | null;
          created_at: string;
          id: string;
          issued_at: string | null;
          payload_hash: string | null;
          proof_id_hash: string | null;
          reason: string;
          scope: string | null;
          subject_id: string | null;
          user_id_hash: string | null;
          version: string | null;
        };
        Insert: {
          action?: string | null;
          created_at?: string;
          id?: string;
          issued_at?: string | null;
          payload_hash?: string | null;
          proof_id_hash?: string | null;
          reason: string;
          scope?: string | null;
          subject_id?: string | null;
          user_id_hash?: string | null;
          version?: string | null;
        };
        Update: {
          action?: string | null;
          created_at?: string;
          id?: string;
          issued_at?: string | null;
          payload_hash?: string | null;
          proof_id_hash?: string | null;
          reason?: string;
          scope?: string | null;
          subject_id?: string | null;
          user_id_hash?: string | null;
          version?: string | null;
        };
        Relationships: [];
      };
      quiz_question_slots: {
        Row: {
          active: boolean;
          category: string | null;
          created_at: string;
          difficulty: string;
          event_id: string;
          id: string;
          slot_index: number;
        };
        Insert: {
          active?: boolean;
          category?: string | null;
          created_at?: string;
          difficulty?: string;
          event_id: string;
          id?: string;
          slot_index: number;
        };
        Update: {
          active?: boolean;
          category?: string | null;
          created_at?: string;
          difficulty?: string;
          event_id?: string;
          id?: string;
          slot_index?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'quiz_question_slots_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_events';
            referencedColumns: ['id'];
          },
        ];
      };
      quiz_question_variants: {
        Row: {
          active: boolean;
          answer_key_hash: string | null;
          created_at: string;
          explanation: string | null;
          id: string;
          options: Json;
          prompt: string;
          slot_id: string;
          variant_key: string;
        };
        Insert: {
          active?: boolean;
          answer_key_hash?: string | null;
          created_at?: string;
          explanation?: string | null;
          id?: string;
          options?: Json;
          prompt: string;
          slot_id: string;
          variant_key: string;
        };
        Update: {
          active?: boolean;
          answer_key_hash?: string | null;
          created_at?: string;
          explanation?: string | null;
          id?: string;
          options?: Json;
          prompt?: string;
          slot_id?: string;
          variant_key?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'quiz_question_variants_slot_id_fkey';
            columns: ['slot_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_question_slots';
            referencedColumns: ['id'];
          },
        ];
      };
      quiz_test_invites: {
        Row: {
          created_at: string;
          created_by: string;
          event_id: string;
          expires_at: string;
          id: string;
          merchant_id: string;
          revoked_at: string | null;
          revoked_by: string | null;
          token_digest: string;
          used_at: string | null;
          used_by: string | null;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          event_id: string;
          expires_at: string;
          id?: string;
          merchant_id: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
          token_digest: string;
          used_at?: string | null;
          used_by?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          event_id?: string;
          expires_at?: string;
          id?: string;
          merchant_id?: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
          token_digest?: string;
          used_at?: string | null;
          used_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'quiz_test_invites_event_merchant_fkey';
            columns: ['event_id', 'merchant_id'];
            isOneToOne: false;
            referencedRelation: 'quiz_events';
            referencedColumns: ['id', 'merchant_id'];
          },
          {
            foreignKeyName: 'quiz_test_invites_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'quiz_test_invites_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quiz_test_invites_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      rate_limit_log: {
        Row: {
          created_at: string;
          endpoint: string;
          identifier: string;
          request_count: number;
          updated_at: string;
          window_start: string;
        };
        Insert: {
          created_at?: string;
          endpoint: string;
          identifier: string;
          request_count?: number;
          updated_at?: string;
          window_start?: string;
        };
        Update: {
          created_at?: string;
          endpoint?: string;
          identifier?: string;
          request_count?: number;
          updated_at?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      receipt_claim_orders: {
        Row: {
          created_at: string;
          order_id: string;
          receipt_claim_id: string;
        };
        Insert: {
          created_at?: string;
          order_id: string;
          receipt_claim_id: string;
        };
        Update: {
          created_at?: string;
          order_id?: string;
          receipt_claim_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'receipt_claim_orders_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'receipt_claim_orders_receipt_claim_id_fkey';
            columns: ['receipt_claim_id'];
            isOneToOne: false;
            referencedRelation: 'receipt_claims';
            referencedColumns: ['id'];
          },
        ];
      };
      receipt_claims: {
        Row: {
          app_download_click_count: number;
          claimed_at: string | null;
          claimed_by_user_id: string | null;
          claimed_source: string | null;
          click_count: number;
          created_at: string;
          customer_email: string;
          customer_email_normalized: string | null;
          customer_id: string;
          customer_name: string | null;
          expires_at: string;
          first_app_download_clicked_at: string | null;
          first_app_download_source: string | null;
          first_click_source: string | null;
          first_clicked_at: string | null;
          first_login_started_at: string | null;
          first_login_started_source: string | null;
          id: string;
          import_job_id: string;
          last_app_download_clicked_at: string | null;
          last_app_download_source: string | null;
          last_click_source: string | null;
          last_clicked_at: string | null;
          last_login_started_at: string | null;
          last_login_started_source: string | null;
          last_viewed_at: string | null;
          login_started_count: number;
          merchant_id: string;
          notification_sent_at: string | null;
          token_hash: string;
          updated_at: string;
        };
        Insert: {
          app_download_click_count?: number;
          claimed_at?: string | null;
          claimed_by_user_id?: string | null;
          claimed_source?: string | null;
          click_count?: number;
          created_at?: string;
          customer_email: string;
          customer_email_normalized?: string | null;
          customer_id: string;
          customer_name?: string | null;
          expires_at?: string;
          first_app_download_clicked_at?: string | null;
          first_app_download_source?: string | null;
          first_click_source?: string | null;
          first_clicked_at?: string | null;
          first_login_started_at?: string | null;
          first_login_started_source?: string | null;
          id?: string;
          import_job_id: string;
          last_app_download_clicked_at?: string | null;
          last_app_download_source?: string | null;
          last_click_source?: string | null;
          last_clicked_at?: string | null;
          last_login_started_at?: string | null;
          last_login_started_source?: string | null;
          last_viewed_at?: string | null;
          login_started_count?: number;
          merchant_id: string;
          notification_sent_at?: string | null;
          token_hash: string;
          updated_at?: string;
        };
        Update: {
          app_download_click_count?: number;
          claimed_at?: string | null;
          claimed_by_user_id?: string | null;
          claimed_source?: string | null;
          click_count?: number;
          created_at?: string;
          customer_email?: string;
          customer_email_normalized?: string | null;
          customer_id?: string;
          customer_name?: string | null;
          expires_at?: string;
          first_app_download_clicked_at?: string | null;
          first_app_download_source?: string | null;
          first_click_source?: string | null;
          first_clicked_at?: string | null;
          first_login_started_at?: string | null;
          first_login_started_source?: string | null;
          id?: string;
          import_job_id?: string;
          last_app_download_clicked_at?: string | null;
          last_app_download_source?: string | null;
          last_click_source?: string | null;
          last_clicked_at?: string | null;
          last_login_started_at?: string | null;
          last_login_started_source?: string | null;
          last_viewed_at?: string | null;
          login_started_count?: number;
          merchant_id?: string;
          notification_sent_at?: string | null;
          token_hash?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'receipt_claims_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'receipt_claims_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'receipt_claims_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'receipt_claims_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'receipt_claims_import_job_id_fkey';
            columns: ['import_job_id'];
            isOneToOne: false;
            referencedRelation: 'import_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'receipt_claims_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'receipt_claims_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'receipt_claims_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      reconciliation_review: {
        Row: {
          candidates: Json | null;
          created_at: string;
          id: string;
          issue_type: string;
          merchant_id: string | null;
          metadata: Json | null;
          order_id: string | null;
          paystack_ref: string | null;
          reason: string | null;
          resolution_notes: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          txn_id: string | null;
        };
        Insert: {
          candidates?: Json | null;
          created_at?: string;
          id?: string;
          issue_type: string;
          merchant_id?: string | null;
          metadata?: Json | null;
          order_id?: string | null;
          paystack_ref?: string | null;
          reason?: string | null;
          resolution_notes?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          txn_id?: string | null;
        };
        Update: {
          candidates?: Json | null;
          created_at?: string;
          id?: string;
          issue_type?: string;
          merchant_id?: string | null;
          metadata?: Json | null;
          order_id?: string | null;
          paystack_ref?: string | null;
          reason?: string | null;
          resolution_notes?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          txn_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'reconciliation_review_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'reconciliation_review_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reconciliation_review_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      reorder_suggestions: {
        Row: {
          accepted_at: string | null;
          avg_daily_sales: number | null;
          created_at: string | null;
          current_stock: number | null;
          id: string;
          lead_time_days: number | null;
          merchant_id: string;
          ordered_quantity: number | null;
          predicted_demand_30d: number | null;
          product_id: string;
          reason: string | null;
          safety_stock_days: number | null;
          status: string | null;
          suggested_quantity: number;
          updated_at: string | null;
          variant_id: string | null;
        };
        Insert: {
          accepted_at?: string | null;
          avg_daily_sales?: number | null;
          created_at?: string | null;
          current_stock?: number | null;
          id?: string;
          lead_time_days?: number | null;
          merchant_id: string;
          ordered_quantity?: number | null;
          predicted_demand_30d?: number | null;
          product_id: string;
          reason?: string | null;
          safety_stock_days?: number | null;
          status?: string | null;
          suggested_quantity: number;
          updated_at?: string | null;
          variant_id?: string | null;
        };
        Update: {
          accepted_at?: string | null;
          avg_daily_sales?: number | null;
          created_at?: string | null;
          current_stock?: number | null;
          id?: string;
          lead_time_days?: number | null;
          merchant_id?: string;
          ordered_quantity?: number | null;
          predicted_demand_30d?: number | null;
          product_id?: string;
          reason?: string | null;
          safety_stock_days?: number | null;
          status?: string | null;
          suggested_quantity?: number;
          updated_at?: string | null;
          variant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'reorder_suggestions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'reorder_suggestions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reorder_suggestions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'reorder_suggestions_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'low_stock_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reorder_suggestions_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'reorder_suggestions_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reorder_suggestions_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'secure_product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'reorder_suggestions_variant_id_fkey';
            columns: ['variant_id'];
            isOneToOne: false;
            referencedRelation: 'product_variants';
            referencedColumns: ['id'];
          },
        ];
      };
      repair_devices: {
        Row: {
          aliases: string[];
          brand: string;
          created_at: string;
          device_type: string | null;
          id: string;
          image_url: string | null;
          is_active: boolean;
          merchant_id: string;
          model: string;
          product_id: string | null;
          slug: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          aliases?: string[];
          brand: string;
          created_at?: string;
          device_type?: string | null;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          merchant_id: string;
          model: string;
          product_id?: string | null;
          slug: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          aliases?: string[];
          brand?: string;
          created_at?: string;
          device_type?: string | null;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          merchant_id?: string;
          model?: string;
          product_id?: string | null;
          slug?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'repair_devices_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'repair_devices_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'repair_devices_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'repair_devices_product_fk';
            columns: ['product_id', 'merchant_id'];
            isOneToOne: false;
            referencedRelation: 'low_stock_products';
            referencedColumns: ['id', 'merchant_id'];
          },
          {
            foreignKeyName: 'repair_devices_product_fk';
            columns: ['product_id', 'merchant_id'];
            isOneToOne: false;
            referencedRelation: 'product_performance';
            referencedColumns: ['product_id', 'merchant_id'];
          },
          {
            foreignKeyName: 'repair_devices_product_fk';
            columns: ['product_id', 'merchant_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id', 'merchant_id'];
          },
          {
            foreignKeyName: 'repair_devices_product_fk';
            columns: ['product_id', 'merchant_id'];
            isOneToOne: false;
            referencedRelation: 'secure_product_performance';
            referencedColumns: ['product_id', 'merchant_id'];
          },
        ];
      };
      repair_pickup_pending_payment_references: {
        Row: {
          consumed_at: string | null;
          created_at: string;
          id: string;
          merchant_id: string;
          reference: string;
          repair_id: string;
        };
        Insert: {
          consumed_at?: string | null;
          created_at?: string;
          id?: string;
          merchant_id: string;
          reference: string;
          repair_id: string;
        };
        Update: {
          consumed_at?: string | null;
          created_at?: string;
          id?: string;
          merchant_id?: string;
          reference?: string;
          repair_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'repair_pickup_pending_payment_references_repair_fk';
            columns: ['repair_id', 'merchant_id'];
            isOneToOne: false;
            referencedRelation: 'repairs';
            referencedColumns: ['id', 'merchant_id'];
          },
        ];
      };
      repair_pickup_quotes: {
        Row: {
          carrier_name: string | null;
          charge: number;
          created_at: string;
          currency: string;
          estimated_days: number | null;
          expires_at: string;
          id: string;
          merchant_id: string;
          provider: string;
          provider_metadata: Json | null;
          provider_rate_id: string | null;
          quote_request: Json;
          repair_id: string;
          service_tier: string | null;
          updated_at: string;
          used: boolean;
        };
        Insert: {
          carrier_name?: string | null;
          charge: number;
          created_at?: string;
          currency?: string;
          estimated_days?: number | null;
          expires_at: string;
          id?: string;
          merchant_id: string;
          provider?: string;
          provider_metadata?: Json | null;
          provider_rate_id?: string | null;
          quote_request: Json;
          repair_id: string;
          service_tier?: string | null;
          updated_at?: string;
          used?: boolean;
        };
        Update: {
          carrier_name?: string | null;
          charge?: number;
          created_at?: string;
          currency?: string;
          estimated_days?: number | null;
          expires_at?: string;
          id?: string;
          merchant_id?: string;
          provider?: string;
          provider_metadata?: Json | null;
          provider_rate_id?: string | null;
          quote_request?: Json;
          repair_id?: string;
          service_tier?: string | null;
          updated_at?: string;
          used?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'repair_pickup_quotes_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'repair_pickup_quotes_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'repair_pickup_quotes_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'repair_pickup_quotes_repair_fk';
            columns: ['repair_id', 'merchant_id'];
            isOneToOne: false;
            referencedRelation: 'repairs';
            referencedColumns: ['id', 'merchant_id'];
          },
        ];
      };
      repair_quotes: {
        Row: {
          created_at: string;
          description: string | null;
          device_id: string;
          id: string;
          internal_notes: string | null;
          is_active: boolean;
          is_from_price: boolean;
          merchant_id: string;
          part_quality: string | null;
          price: number;
          service_type_id: string;
          turnaround: string | null;
          updated_at: string;
          warranty_days: number | null;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          device_id: string;
          id?: string;
          internal_notes?: string | null;
          is_active?: boolean;
          is_from_price?: boolean;
          merchant_id: string;
          part_quality?: string | null;
          price: number;
          service_type_id: string;
          turnaround?: string | null;
          updated_at?: string;
          warranty_days?: number | null;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          device_id?: string;
          id?: string;
          internal_notes?: string | null;
          is_active?: boolean;
          is_from_price?: boolean;
          merchant_id?: string;
          part_quality?: string | null;
          price?: number;
          service_type_id?: string;
          turnaround?: string | null;
          updated_at?: string;
          warranty_days?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'repair_quotes_device_fk';
            columns: ['device_id', 'merchant_id'];
            isOneToOne: false;
            referencedRelation: 'repair_devices';
            referencedColumns: ['id', 'merchant_id'];
          },
          {
            foreignKeyName: 'repair_quotes_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'repair_quotes_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'repair_quotes_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'repair_quotes_service_type_fk';
            columns: ['service_type_id', 'merchant_id'];
            isOneToOne: false;
            referencedRelation: 'repair_service_types';
            referencedColumns: ['id', 'merchant_id'];
          },
        ];
      };
      repair_service_types: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          is_active: boolean;
          merchant_id: string;
          name: string;
          slug: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          merchant_id: string;
          name: string;
          slug: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          merchant_id?: string;
          name?: string;
          slug?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'repair_service_types_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'repair_service_types_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'repair_service_types_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      repairs: {
        Row: {
          admin_notes: string | null;
          created_at: string;
          customer_email: string;
          customer_name: string;
          customer_phone: string;
          device_id: string | null;
          device_model: string;
          device_type: string;
          estimated_cost: number | null;
          id: string;
          issue_description: string;
          merchant_id: string;
          pickup_address: string | null;
          pickup_booking_lock_token: string | null;
          pickup_booking_started_at: string | null;
          pickup_currency: string | null;
          pickup_fee: number | null;
          pickup_paid_at: string | null;
          pickup_payment_pending_reference: string | null;
          pickup_payment_reference: string | null;
          pickup_payment_status: string | null;
          preferred_date: string | null;
          quote_id: string | null;
          quoted_price: number | null;
          repair_type_label: string | null;
          service_type: string;
          shipment_id: string | null;
          status: Database['public']['Enums']['repair_status'];
          ticket_number: number;
          updated_at: string;
        };
        Insert: {
          admin_notes?: string | null;
          created_at?: string;
          customer_email: string;
          customer_name: string;
          customer_phone: string;
          device_id?: string | null;
          device_model: string;
          device_type: string;
          estimated_cost?: number | null;
          id?: string;
          issue_description: string;
          merchant_id: string;
          pickup_address?: string | null;
          pickup_booking_lock_token?: string | null;
          pickup_booking_started_at?: string | null;
          pickup_currency?: string | null;
          pickup_fee?: number | null;
          pickup_paid_at?: string | null;
          pickup_payment_pending_reference?: string | null;
          pickup_payment_reference?: string | null;
          pickup_payment_status?: string | null;
          preferred_date?: string | null;
          quote_id?: string | null;
          quoted_price?: number | null;
          repair_type_label?: string | null;
          service_type?: string;
          shipment_id?: string | null;
          status?: Database['public']['Enums']['repair_status'];
          ticket_number?: number;
          updated_at?: string;
        };
        Update: {
          admin_notes?: string | null;
          created_at?: string;
          customer_email?: string;
          customer_name?: string;
          customer_phone?: string;
          device_id?: string | null;
          device_model?: string;
          device_type?: string;
          estimated_cost?: number | null;
          id?: string;
          issue_description?: string;
          merchant_id?: string;
          pickup_address?: string | null;
          pickup_booking_lock_token?: string | null;
          pickup_booking_started_at?: string | null;
          pickup_currency?: string | null;
          pickup_fee?: number | null;
          pickup_paid_at?: string | null;
          pickup_payment_pending_reference?: string | null;
          pickup_payment_reference?: string | null;
          pickup_payment_status?: string | null;
          preferred_date?: string | null;
          quote_id?: string | null;
          quoted_price?: number | null;
          repair_type_label?: string | null;
          service_type?: string;
          shipment_id?: string | null;
          status?: Database['public']['Enums']['repair_status'];
          ticket_number?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'repairs_device_fk';
            columns: ['device_id', 'merchant_id'];
            isOneToOne: false;
            referencedRelation: 'repair_devices';
            referencedColumns: ['id', 'merchant_id'];
          },
          {
            foreignKeyName: 'repairs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'repairs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'repairs_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'repairs_quote_fk';
            columns: ['quote_id', 'merchant_id'];
            isOneToOne: false;
            referencedRelation: 'repair_quotes';
            referencedColumns: ['id', 'merchant_id'];
          },
          {
            foreignKeyName: 'repairs_shipment_fk';
            columns: ['shipment_id', 'merchant_id'];
            isOneToOne: false;
            referencedRelation: 'shipments';
            referencedColumns: ['id', 'merchant_id'];
          },
        ];
      };
      reserved_usernames: {
        Row: {
          created_at: string;
          name: string;
        };
        Insert: {
          created_at?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          name?: string;
        };
        Relationships: [];
      };
      return_requests: {
        Row: {
          created_at: string | null;
          evidence_urls: string[] | null;
          id: string;
          items: Json;
          merchant_id: string;
          notes: string | null;
          order_id: string;
          reason: string;
          refund_amount: number | null;
          resolved_at: string | null;
          status: string;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          evidence_urls?: string[] | null;
          id?: string;
          items?: Json;
          merchant_id: string;
          notes?: string | null;
          order_id: string;
          reason: string;
          refund_amount?: number | null;
          resolved_at?: string | null;
          status?: string;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          evidence_urls?: string[] | null;
          id?: string;
          items?: Json;
          merchant_id?: string;
          notes?: string | null;
          order_id?: string;
          reason?: string;
          refund_amount?: number | null;
          resolved_at?: string | null;
          status?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'return_requests_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'return_requests_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'return_requests_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'return_requests_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      review_helpful_votes: {
        Row: {
          created_at: string | null;
          id: string;
          review_id: string;
          voter_identifier: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          review_id: string;
          voter_identifier: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          review_id?: string;
          voter_identifier?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'review_helpful_votes_review_id_fkey';
            columns: ['review_id'];
            isOneToOne: false;
            referencedRelation: 'product_reviews';
            referencedColumns: ['id'];
          },
        ];
      };
      reward_redemptions: {
        Row: {
          created_at: string | null;
          customer_id: string;
          discount_code: string | null;
          expires_at: string | null;
          id: string;
          merchant_id: string;
          points_spent: number;
          reward_id: string | null;
          reward_type: string;
          reward_value: number | null;
          used: boolean | null;
          used_at: string | null;
          used_on_order_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          customer_id: string;
          discount_code?: string | null;
          expires_at?: string | null;
          id?: string;
          merchant_id: string;
          points_spent: number;
          reward_id?: string | null;
          reward_type: string;
          reward_value?: number | null;
          used?: boolean | null;
          used_at?: string | null;
          used_on_order_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          customer_id?: string;
          discount_code?: string | null;
          expires_at?: string | null;
          id?: string;
          merchant_id?: string;
          points_spent?: number;
          reward_id?: string | null;
          reward_type?: string;
          reward_value?: number | null;
          used?: boolean | null;
          used_at?: string | null;
          used_on_order_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'reward_redemptions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'reward_redemptions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reward_redemptions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reward_redemptions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'reward_redemptions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'reward_redemptions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reward_redemptions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'reward_redemptions_reward_id_fkey';
            columns: ['reward_id'];
            isOneToOne: false;
            referencedRelation: 'loyalty_rewards';
            referencedColumns: ['id'];
          },
        ];
      };
      role_permissions: {
        Row: {
          permissions: Json;
          role: Database['public']['Enums']['staff_role'];
        };
        Insert: {
          permissions?: Json;
          role: Database['public']['Enums']['staff_role'];
        };
        Update: {
          permissions?: Json;
          role?: Database['public']['Enums']['staff_role'];
        };
        Relationships: [];
      };
      santa_interactions: {
        Row: {
          approved_price: number | null;
          client_ip: string | null;
          created_at: string;
          discount_percentage: number | null;
          id: string;
          interaction_type: string;
          merchant_id: string;
          order_id: string | null;
          product_name: string | null;
          requested_price: number | null;
          santa_response: string | null;
          session_id: string;
          user_message: string | null;
        };
        Insert: {
          approved_price?: number | null;
          client_ip?: string | null;
          created_at?: string;
          discount_percentage?: number | null;
          id?: string;
          interaction_type: string;
          merchant_id: string;
          order_id?: string | null;
          product_name?: string | null;
          requested_price?: number | null;
          santa_response?: string | null;
          session_id: string;
          user_message?: string | null;
        };
        Update: {
          approved_price?: number | null;
          client_ip?: string | null;
          created_at?: string;
          discount_percentage?: number | null;
          id?: string;
          interaction_type?: string;
          merchant_id?: string;
          order_id?: string | null;
          product_name?: string | null;
          requested_price?: number | null;
          santa_response?: string | null;
          session_id?: string;
          user_message?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'santa_interactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'santa_interactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'santa_interactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'santa_interactions_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      search_analytics: {
        Row: {
          clicked_position: number | null;
          clicked_product_id: string | null;
          created_at: string | null;
          id: string;
          merchant_id: string;
          results_count: number | null;
          search_method: string | null;
          search_query: string;
          user_session_id: string | null;
        };
        Insert: {
          clicked_position?: number | null;
          clicked_product_id?: string | null;
          created_at?: string | null;
          id?: string;
          merchant_id: string;
          results_count?: number | null;
          search_method?: string | null;
          search_query: string;
          user_session_id?: string | null;
        };
        Update: {
          clicked_position?: number | null;
          clicked_product_id?: string | null;
          created_at?: string | null;
          id?: string;
          merchant_id?: string;
          results_count?: number | null;
          search_method?: string | null;
          search_query?: string;
          user_session_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'search_analytics_clicked_product_id_fkey';
            columns: ['clicked_product_id'];
            isOneToOne: false;
            referencedRelation: 'low_stock_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'search_analytics_clicked_product_id_fkey';
            columns: ['clicked_product_id'];
            isOneToOne: false;
            referencedRelation: 'product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'search_analytics_clicked_product_id_fkey';
            columns: ['clicked_product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'search_analytics_clicked_product_id_fkey';
            columns: ['clicked_product_id'];
            isOneToOne: false;
            referencedRelation: 'secure_product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'search_analytics_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'search_analytics_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'search_analytics_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      segment_definitions: {
        Row: {
          color: string | null;
          created_at: string | null;
          description: string | null;
          id: string;
          max_frequency_score: number | null;
          max_monetary_score: number | null;
          max_recency_score: number | null;
          merchant_id: string | null;
          min_frequency_score: number | null;
          min_monetary_score: number | null;
          min_recency_score: number | null;
          priority: number | null;
          recommended_actions: Json | null;
          segment_name: string;
          segment_type: string;
        };
        Insert: {
          color?: string | null;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          max_frequency_score?: number | null;
          max_monetary_score?: number | null;
          max_recency_score?: number | null;
          merchant_id?: string | null;
          min_frequency_score?: number | null;
          min_monetary_score?: number | null;
          min_recency_score?: number | null;
          priority?: number | null;
          recommended_actions?: Json | null;
          segment_name: string;
          segment_type?: string;
        };
        Update: {
          color?: string | null;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          max_frequency_score?: number | null;
          max_monetary_score?: number | null;
          max_recency_score?: number | null;
          merchant_id?: string | null;
          min_frequency_score?: number | null;
          min_monetary_score?: number | null;
          min_recency_score?: number | null;
          priority?: number | null;
          recommended_actions?: Json | null;
          segment_name?: string;
          segment_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'segment_definitions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'segment_definitions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'segment_definitions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      shipment_tracking_events: {
        Row: {
          created_at: string;
          description: string;
          id: string;
          location: string | null;
          normalized_status: string;
          occurred_at: string;
          provider: string;
          provider_event_id: string | null;
          provider_event_key: string;
          raw_status: string;
          shipment_id: string;
          tracking_epoch_id: string;
          tracking_number: string;
        };
        Insert: {
          created_at?: string;
          description: string;
          id?: string;
          location?: string | null;
          normalized_status: string;
          occurred_at: string;
          provider: string;
          provider_event_id?: string | null;
          provider_event_key: string;
          raw_status: string;
          shipment_id: string;
          tracking_epoch_id: string;
          tracking_number: string;
        };
        Update: {
          created_at?: string;
          description?: string;
          id?: string;
          location?: string | null;
          normalized_status?: string;
          occurred_at?: string;
          provider?: string;
          provider_event_id?: string | null;
          provider_event_key?: string;
          raw_status?: string;
          shipment_id?: string;
          tracking_epoch_id?: string;
          tracking_number?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'shipment_tracking_events_shipment_id_fkey';
            columns: ['shipment_id'];
            isOneToOne: false;
            referencedRelation: 'shipments';
            referencedColumns: ['id'];
          },
        ];
      };
      shipment_tracking_monitors: {
        Row: {
          consecutive_failures: number;
          created_at: string;
          last_error: string | null;
          last_event_at: string | null;
          last_polled_at: string | null;
          locked_at: string | null;
          locked_by: string | null;
          manual_terminal_override_at: string | null;
          next_poll_at: string | null;
          notification_events_not_before: string | null;
          order_id: string | null;
          provider: string;
          shipment_id: string;
          started_at: string;
          state: string;
          stopped_at: string | null;
          storefront_refresh_lease_until: string | null;
          storefront_refresh_requested_at: string | null;
          tracking_epoch_id: string;
          tracking_number: string;
          tracking_timeline_generation: number;
          unchanged_poll_count: number;
          updated_at: string;
        };
        Insert: {
          consecutive_failures?: number;
          created_at?: string;
          last_error?: string | null;
          last_event_at?: string | null;
          last_polled_at?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          manual_terminal_override_at?: string | null;
          next_poll_at?: string | null;
          notification_events_not_before?: string | null;
          order_id?: string | null;
          provider: string;
          shipment_id: string;
          started_at?: string;
          state?: string;
          stopped_at?: string | null;
          storefront_refresh_lease_until?: string | null;
          storefront_refresh_requested_at?: string | null;
          tracking_epoch_id?: string;
          tracking_number: string;
          tracking_timeline_generation: number;
          unchanged_poll_count?: number;
          updated_at?: string;
        };
        Update: {
          consecutive_failures?: number;
          created_at?: string;
          last_error?: string | null;
          last_event_at?: string | null;
          last_polled_at?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          manual_terminal_override_at?: string | null;
          next_poll_at?: string | null;
          notification_events_not_before?: string | null;
          order_id?: string | null;
          provider?: string;
          shipment_id?: string;
          started_at?: string;
          state?: string;
          stopped_at?: string | null;
          storefront_refresh_lease_until?: string | null;
          storefront_refresh_requested_at?: string | null;
          tracking_epoch_id?: string;
          tracking_number?: string;
          tracking_timeline_generation?: number;
          unchanged_poll_count?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'shipment_tracking_monitors_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shipment_tracking_monitors_shipment_id_fkey';
            columns: ['shipment_id'];
            isOneToOne: true;
            referencedRelation: 'shipments';
            referencedColumns: ['id'];
          },
        ];
      };
      shipment_tracking_notification_outbox: {
        Row: {
          attempt_count: number;
          audience: string;
          created_at: string;
          delivery_started_at: string | null;
          id: string;
          last_error: string | null;
          locked_at: string | null;
          locked_by: string | null;
          max_attempts: number;
          merchant_id: string;
          next_attempt_at: string;
          notification_kind: string;
          order_id: string | null;
          sent_at: string | null;
          shipment_id: string;
          skip_reason: string | null;
          skipped_at: string | null;
          status: string;
          tracking_epoch_id: string;
          tracking_event_id: string;
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          audience: string;
          created_at?: string;
          delivery_started_at?: string | null;
          id?: string;
          last_error?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          merchant_id: string;
          next_attempt_at?: string;
          notification_kind: string;
          order_id?: string | null;
          sent_at?: string | null;
          shipment_id: string;
          skip_reason?: string | null;
          skipped_at?: string | null;
          status?: string;
          tracking_epoch_id: string;
          tracking_event_id: string;
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          audience?: string;
          created_at?: string;
          delivery_started_at?: string | null;
          id?: string;
          last_error?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          max_attempts?: number;
          merchant_id?: string;
          next_attempt_at?: string;
          notification_kind?: string;
          order_id?: string | null;
          sent_at?: string | null;
          shipment_id?: string;
          skip_reason?: string | null;
          skipped_at?: string | null;
          status?: string;
          tracking_epoch_id?: string;
          tracking_event_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'shipment_tracking_notification_outbox_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'shipment_tracking_notification_outbox_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shipment_tracking_notification_outbox_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'shipment_tracking_notification_outbox_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shipment_tracking_notification_outbox_shipment_id_fkey';
            columns: ['shipment_id'];
            isOneToOne: false;
            referencedRelation: 'shipments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shipment_tracking_notification_outbox_tracking_event_id_fkey';
            columns: ['tracking_event_id'];
            isOneToOne: false;
            referencedRelation: 'shipment_tracking_events';
            referencedColumns: ['id'];
          },
        ];
      };
      shipments: {
        Row: {
          cancelled_at: string | null;
          carrier_name: string | null;
          created_at: string | null;
          currency: string | null;
          current_location: string | null;
          delivered_at: string | null;
          estimated_delivery_at: string | null;
          estimated_delivery_days: number | null;
          id: string;
          is_station_pickup: boolean | null;
          items: Json;
          label_url: string | null;
          last_tracked_at: string | null;
          merchant_id: string;
          order_id: string | null;
          pickup_scheduled_at: string | null;
          price: number | null;
          provider: string;
          provider_response: Json | null;
          provider_shipment_id: string | null;
          shipping_quote_id: string | null;
          receiver_address: Json;
          refund_amount: number | null;
          sender_address: Json;
          service_tier: string | null;
          station_address: string | null;
          station_name: string | null;
          status: string;
          tracking_events: Json | null;
          tracking_number: string | null;
          tracking_snapshot_version: number;
          tracking_timeline_generation: number;
          updated_at: string | null;
        };
        Insert: {
          cancelled_at?: string | null;
          carrier_name?: string | null;
          created_at?: string | null;
          currency?: string | null;
          current_location?: string | null;
          delivered_at?: string | null;
          estimated_delivery_at?: string | null;
          estimated_delivery_days?: number | null;
          id?: string;
          is_station_pickup?: boolean | null;
          items: Json;
          label_url?: string | null;
          last_tracked_at?: string | null;
          merchant_id: string;
          order_id?: string | null;
          pickup_scheduled_at?: string | null;
          price?: number | null;
          provider: string;
          provider_response?: Json | null;
          provider_shipment_id?: string | null;
          shipping_quote_id?: string | null;
          receiver_address: Json;
          refund_amount?: number | null;
          sender_address: Json;
          service_tier?: string | null;
          station_address?: string | null;
          station_name?: string | null;
          status?: string;
          tracking_events?: Json | null;
          tracking_number?: string | null;
          tracking_snapshot_version?: number;
          tracking_timeline_generation?: number;
          updated_at?: string | null;
        };
        Update: {
          cancelled_at?: string | null;
          carrier_name?: string | null;
          created_at?: string | null;
          currency?: string | null;
          current_location?: string | null;
          delivered_at?: string | null;
          estimated_delivery_at?: string | null;
          estimated_delivery_days?: number | null;
          id?: string;
          is_station_pickup?: boolean | null;
          items?: Json;
          label_url?: string | null;
          last_tracked_at?: string | null;
          merchant_id?: string;
          order_id?: string | null;
          pickup_scheduled_at?: string | null;
          price?: number | null;
          provider?: string;
          provider_response?: Json | null;
          provider_shipment_id?: string | null;
          shipping_quote_id?: string | null;
          receiver_address?: Json;
          refund_amount?: number | null;
          sender_address?: Json;
          service_tier?: string | null;
          station_address?: string | null;
          station_name?: string | null;
          status?: string;
          tracking_events?: Json | null;
          tracking_number?: string | null;
          tracking_snapshot_version?: number;
          tracking_timeline_generation?: number;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'shipments_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'shipments_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shipments_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'shipments_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shipments_shipping_quote_id_fkey';
            columns: ['shipping_quote_id'];
            isOneToOne: false;
            referencedRelation: 'shipping_quotes';
            referencedColumns: ['id'];
          },
        ];
      };
      shipping_provider_service_centres: {
        Row: {
          address: string | null;
          is_active: boolean;
          location: unknown;
          provider: string;
          service_centre_code: string | null;
          service_centre_id: number;
          service_centre_name: string;
          source_synced_at: string;
          station_code: string | null;
          station_id: number;
          station_name: string;
          sync_generation: string;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          is_active?: boolean;
          location?: unknown;
          provider: string;
          service_centre_code?: string | null;
          service_centre_id: number;
          service_centre_name: string;
          source_synced_at: string;
          station_code?: string | null;
          station_id: number;
          station_name: string;
          sync_generation: string;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          is_active?: boolean;
          location?: unknown;
          provider?: string;
          service_centre_code?: string | null;
          service_centre_id?: number;
          service_centre_name?: string;
          source_synced_at?: string;
          station_code?: string | null;
          station_id?: number;
          station_name?: string;
          sync_generation?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      shipping_quotes: {
        Row: {
          carrier_name: string | null;
          created_at: string | null;
          currency: string | null;
          estimated_days: number | null;
          expires_at: string;
          id: string;
          insurance_included: boolean | null;
          is_station_pickup: boolean | null;
          max_days: number | null;
          merchant_id: string | null;
          min_days: number | null;
          pickup_included: boolean | null;
          price: number;
          provider: string;
          provider_metadata: Json | null;
          provider_rate_id: string | null;
          quote_request: Json | null;
          service_tier: string | null;
          session_id: string;
          station_address: string | null;
          station_name: string | null;
          used: boolean | null;
        };
        Insert: {
          carrier_name?: string | null;
          created_at?: string | null;
          currency?: string | null;
          estimated_days?: number | null;
          expires_at: string;
          id?: string;
          insurance_included?: boolean | null;
          is_station_pickup?: boolean | null;
          max_days?: number | null;
          merchant_id?: string | null;
          min_days?: number | null;
          pickup_included?: boolean | null;
          price: number;
          provider: string;
          provider_metadata?: Json | null;
          provider_rate_id?: string | null;
          quote_request?: Json | null;
          service_tier?: string | null;
          session_id: string;
          station_address?: string | null;
          station_name?: string | null;
          used?: boolean | null;
        };
        Update: {
          carrier_name?: string | null;
          created_at?: string | null;
          currency?: string | null;
          estimated_days?: number | null;
          expires_at?: string;
          id?: string;
          insurance_included?: boolean | null;
          is_station_pickup?: boolean | null;
          max_days?: number | null;
          merchant_id?: string | null;
          min_days?: number | null;
          pickup_included?: boolean | null;
          price?: number;
          provider?: string;
          provider_metadata?: Json | null;
          provider_rate_id?: string | null;
          quote_request?: Json | null;
          service_tier?: string | null;
          session_id?: string;
          station_address?: string | null;
          station_name?: string | null;
          used?: boolean | null;
        };
        Relationships: [
          {
            foreignKeyName: 'shipping_quotes_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'shipping_quotes_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shipping_quotes_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      shipping_webhook_events: {
        Row: {
          created_at: string | null;
          error: string | null;
          event_type: string | null;
          id: string;
          payload: Json;
          processed: boolean | null;
          processed_at: string | null;
          provider: string;
          shipment_id: string | null;
          tracking_number: string | null;
        };
        Insert: {
          created_at?: string | null;
          error?: string | null;
          event_type?: string | null;
          id?: string;
          payload: Json;
          processed?: boolean | null;
          processed_at?: string | null;
          provider: string;
          shipment_id?: string | null;
          tracking_number?: string | null;
        };
        Update: {
          created_at?: string | null;
          error?: string | null;
          event_type?: string | null;
          id?: string;
          payload?: Json;
          processed?: boolean | null;
          processed_at?: string | null;
          provider?: string;
          shipment_id?: string | null;
          tracking_number?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'shipping_webhook_events_shipment_id_fkey';
            columns: ['shipment_id'];
            isOneToOne: false;
            referencedRelation: 'shipments';
            referencedColumns: ['id'];
          },
        ];
      };
      staff_members: {
        Row: {
          accepted_at: string | null;
          created_at: string | null;
          email: string;
          id: string;
          invitation_expires_at: string | null;
          invitation_token: string | null;
          invited_at: string | null;
          last_login_at: string | null;
          merchant_id: string;
          name: string | null;
          permissions: Json | null;
          phone: string | null;
          role: Database['public']['Enums']['staff_role'];
          status: string;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string | null;
          email: string;
          id?: string;
          invitation_expires_at?: string | null;
          invitation_token?: string | null;
          invited_at?: string | null;
          last_login_at?: string | null;
          merchant_id: string;
          name?: string | null;
          permissions?: Json | null;
          phone?: string | null;
          role?: Database['public']['Enums']['staff_role'];
          status?: string;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string | null;
          email?: string;
          id?: string;
          invitation_expires_at?: string | null;
          invitation_token?: string | null;
          invited_at?: string | null;
          last_login_at?: string | null;
          merchant_id?: string;
          name?: string | null;
          permissions?: Json | null;
          phone?: string | null;
          role?: Database['public']['Enums']['staff_role'];
          status?: string;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'staff_members_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'staff_members_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_members_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      transactions: {
        Row: {
          amount: number;
          created_at: string | null;
          currency: string;
          description: string | null;
          gateway: string | null;
          gateway_reference: string | null;
          gateway_response: Json | null;
          id: string;
          merchant_amount: number | null;
          merchant_id: string;
          metadata: Json | null;
          order_id: string | null;
          platform_fee: number | null;
          status: string;
          transaction_type: string;
          updated_at: string | null;
        };
        Insert: {
          amount: number;
          created_at?: string | null;
          currency: string;
          description?: string | null;
          gateway?: string | null;
          gateway_reference?: string | null;
          gateway_response?: Json | null;
          id?: string;
          merchant_amount?: number | null;
          merchant_id: string;
          metadata?: Json | null;
          order_id?: string | null;
          platform_fee?: number | null;
          status?: string;
          transaction_type: string;
          updated_at?: string | null;
        };
        Update: {
          amount?: number;
          created_at?: string | null;
          currency?: string;
          description?: string | null;
          gateway?: string | null;
          gateway_reference?: string | null;
          gateway_response?: Json | null;
          id?: string;
          merchant_amount?: number | null;
          merchant_id?: string;
          metadata?: Json | null;
          order_id?: string | null;
          platform_fee?: number | null;
          status?: string;
          transaction_type?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'transactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'transactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'transactions_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      variant_inventory: {
        Row: {
          branch_id: string | null;
          created_at: string | null;
          first_reserved_at: string | null;
          id: string;
          identifier_type: string;
          identifier_value: string;
          merchant_id: string;
          notes: string | null;
          order_id: string | null;
          order_item_id: string | null;
          reservation_expires_at: string | null;
          reserved_at: string | null;
          sold_at: string | null;
          source: string;
          status: string;
          updated_at: string | null;
          variant_id: string;
        };
        Insert: {
          branch_id?: string | null;
          created_at?: string | null;
          first_reserved_at?: string | null;
          id?: string;
          identifier_type: string;
          identifier_value: string;
          merchant_id: string;
          notes?: string | null;
          order_id?: string | null;
          order_item_id?: string | null;
          reservation_expires_at?: string | null;
          reserved_at?: string | null;
          sold_at?: string | null;
          source?: string;
          status?: string;
          updated_at?: string | null;
          variant_id: string;
        };
        Update: {
          branch_id?: string | null;
          created_at?: string | null;
          first_reserved_at?: string | null;
          id?: string;
          identifier_type?: string;
          identifier_value?: string;
          merchant_id?: string;
          notes?: string | null;
          order_id?: string | null;
          order_item_id?: string | null;
          reservation_expires_at?: string | null;
          reserved_at?: string | null;
          sold_at?: string | null;
          source?: string;
          status?: string;
          updated_at?: string | null;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'variant_inventory_branch_id_fkey';
            columns: ['branch_id'];
            isOneToOne: false;
            referencedRelation: 'branches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'variant_inventory_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'variant_inventory_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'variant_inventory_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'variant_inventory_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'variant_inventory_order_item_id_fkey';
            columns: ['order_item_id'];
            isOneToOne: false;
            referencedRelation: 'order_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'variant_inventory_variant_id_fkey';
            columns: ['variant_id'];
            isOneToOne: false;
            referencedRelation: 'product_variants';
            referencedColumns: ['id'];
          },
        ];
      };
      virtual_terminals: {
        Row: {
          account_name: string | null;
          account_number: string | null;
          active: boolean | null;
          bank: string | null;
          branch_id: string | null;
          code: string;
          created_at: string | null;
          id: string;
          merchant_id: string;
          name: string;
          payment_link: string | null;
          staff_id: string | null;
          updated_at: string | null;
        };
        Insert: {
          account_name?: string | null;
          account_number?: string | null;
          active?: boolean | null;
          bank?: string | null;
          branch_id?: string | null;
          code: string;
          created_at?: string | null;
          id?: string;
          merchant_id: string;
          name: string;
          payment_link?: string | null;
          staff_id?: string | null;
          updated_at?: string | null;
        };
        Update: {
          account_name?: string | null;
          account_number?: string | null;
          active?: boolean | null;
          bank?: string | null;
          branch_id?: string | null;
          code?: string;
          created_at?: string | null;
          id?: string;
          merchant_id?: string;
          name?: string;
          payment_link?: string | null;
          staff_id?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'virtual_terminals_branch_id_fkey';
            columns: ['branch_id'];
            isOneToOne: false;
            referencedRelation: 'branches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'virtual_terminals_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'virtual_terminals_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'virtual_terminals_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'virtual_terminals_staff_id_fkey';
            columns: ['staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_members';
            referencedColumns: ['id'];
          },
        ];
      };
      vtu_idempotency_keys: {
        Row: {
          created_at: string;
          customer_id: string;
          key: string;
          merchant_id: string;
          request_fingerprint: string;
          vtu_transaction_id: string;
        };
        Insert: {
          created_at?: string;
          customer_id: string;
          key: string;
          merchant_id: string;
          request_fingerprint: string;
          vtu_transaction_id: string;
        };
        Update: {
          created_at?: string;
          customer_id?: string;
          key?: string;
          merchant_id?: string;
          request_fingerprint?: string;
          vtu_transaction_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'vtu_idempotency_keys_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'vtu_idempotency_keys_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'vtu_idempotency_keys_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'vtu_idempotency_keys_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'vtu_idempotency_keys_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'vtu_idempotency_keys_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'vtu_idempotency_keys_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'vtu_idempotency_keys_vtu_transaction_id_fkey';
            columns: ['vtu_transaction_id'];
            isOneToOne: false;
            referencedRelation: 'vtu_transactions';
            referencedColumns: ['id'];
          },
        ];
      };
      vtu_transactions: {
        Row: {
          amount: number;
          biller_item_code: string | null;
          biller_name: string | null;
          created_at: string | null;
          customer_cashback: number | null;
          customer_id: string | null;
          customer_identifier: string | null;
          customer_name: string | null;
          error_message: string | null;
          id: string;
          merchant_commission: number | null;
          merchant_id: string;
          metadata: Json | null;
          network_provider: string;
          order_id: string | null;
          phone_number: string;
          platform_commission: number | null;
          request_reference: string;
          source: string;
          status: string;
          transaction_id: string | null;
          type: string;
          updated_at: string | null;
        };
        Insert: {
          amount: number;
          biller_item_code?: string | null;
          biller_name?: string | null;
          created_at?: string | null;
          customer_cashback?: number | null;
          customer_id?: string | null;
          customer_identifier?: string | null;
          customer_name?: string | null;
          error_message?: string | null;
          id?: string;
          merchant_commission?: number | null;
          merchant_id: string;
          metadata?: Json | null;
          network_provider: string;
          order_id?: string | null;
          phone_number: string;
          platform_commission?: number | null;
          request_reference: string;
          source?: string;
          status?: string;
          transaction_id?: string | null;
          type: string;
          updated_at?: string | null;
        };
        Update: {
          amount?: number;
          biller_item_code?: string | null;
          biller_name?: string | null;
          created_at?: string | null;
          customer_cashback?: number | null;
          customer_id?: string | null;
          customer_identifier?: string | null;
          customer_name?: string | null;
          error_message?: string | null;
          id?: string;
          merchant_commission?: number | null;
          merchant_id?: string;
          metadata?: Json | null;
          network_provider?: string;
          order_id?: string | null;
          phone_number?: string;
          platform_commission?: number | null;
          request_reference?: string;
          source?: string;
          status?: string;
          transaction_id?: string | null;
          type?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'vtu_transactions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'vtu_transactions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'vtu_transactions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'vtu_transactions_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'vtu_transactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'vtu_transactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'vtu_transactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'vtu_transactions_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      wallet_transactions: {
        Row: {
          amount: number;
          balance_after: number;
          created_at: string | null;
          description: string | null;
          id: string;
          merchant_id: string;
          metadata: Json | null;
          source_id: string | null;
          source_type: string | null;
          status: string | null;
          transfer_message: string | null;
          transfer_reference: string | null;
          transfer_status: string | null;
          type: string;
          wallet_id: string;
        };
        Insert: {
          amount: number;
          balance_after: number;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          merchant_id: string;
          metadata?: Json | null;
          source_id?: string | null;
          source_type?: string | null;
          status?: string | null;
          transfer_message?: string | null;
          transfer_reference?: string | null;
          transfer_status?: string | null;
          type: string;
          wallet_id: string;
        };
        Update: {
          amount?: number;
          balance_after?: number;
          created_at?: string | null;
          description?: string | null;
          id?: string;
          merchant_id?: string;
          metadata?: Json | null;
          source_id?: string | null;
          source_type?: string | null;
          status?: string | null;
          transfer_message?: string | null;
          transfer_reference?: string | null;
          transfer_status?: string | null;
          type?: string;
          wallet_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'wallet_transactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'wallet_transactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'wallet_transactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'wallet_transactions_wallet_id_fkey';
            columns: ['wallet_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_wallets';
            referencedColumns: ['id'];
          },
        ];
      };
      wish_list_items: {
        Row: {
          created_at: string | null;
          customer_email: string;
          id: string;
          merchant_id: string;
          product_id: string;
        };
        Insert: {
          created_at?: string | null;
          customer_email: string;
          id?: string;
          merchant_id: string;
          product_id: string;
        };
        Update: {
          created_at?: string | null;
          customer_email?: string;
          id?: string;
          merchant_id?: string;
          product_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'wish_list_items_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'wish_list_items_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'wish_list_items_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'wish_list_items_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'low_stock_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'wish_list_items_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'product_performance';
            referencedColumns: ['product_id'];
          },
          {
            foreignKeyName: 'wish_list_items_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'wish_list_items_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'secure_product_performance';
            referencedColumns: ['product_id'];
          },
        ];
      };
    };
    Views: {
      admin_query_performance: {
        Row: {
          cache_hit_ratio: number | null;
          calls: number | null;
          max_exec_time: number | null;
          mean_exec_time: number | null;
          min_exec_time: number | null;
          query_preview: string | null;
          rows: number | null;
          stddev_exec_time: number | null;
          total_exec_time: number | null;
        };
        Relationships: [];
      };
      customer_insights: {
        Row: {
          avg_order_value: number | null;
          customer_id: string | null;
          email: string | null;
          first_order_date: string | null;
          last_order_date: string | null;
          lifetime_value: number | null;
          merchant_id: string | null;
          name: string | null;
          total_orders: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'customers_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customers_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customers_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      customer_segment_summary: {
        Row: {
          avg_clv: number | null;
          customer_count: number | null;
          merchant_id: string | null;
          segment_name: string | null;
          total_revenue: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_rfm_scores_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customer_rfm_scores_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_rfm_scores_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      daily_sales_summary: {
        Row: {
          avg_order_value: number | null;
          merchant_id: string | null;
          order_count: number | null;
          paid_orders: number | null;
          paid_revenue: number | null;
          pending_orders: number | null;
          sale_date: string | null;
          total_revenue: number | null;
          unique_customers: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'orders_merchant_id_fkey1';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'orders_merchant_id_fkey1';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_merchant_id_fkey1';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      imei_lookup_customer_status: {
        Row: {
          amount_ngn: number | null;
          cached_response: Json | null;
          cached_status: number | null;
          created_at: string | null;
          customer_id: string | null;
          id: string | null;
          merchant_id: string | null;
          status: string | null;
          tier: string | null;
          updated_at: string | null;
        };
        Insert: {
          amount_ngn?: number | null;
          cached_response?: Json | null;
          cached_status?: number | null;
          created_at?: string | null;
          customer_id?: string | null;
          id?: string | null;
          merchant_id?: string | null;
          status?: string | null;
          tier?: string | null;
          updated_at?: string | null;
        };
        Update: {
          amount_ngn?: number | null;
          cached_response?: Json | null;
          cached_status?: number | null;
          created_at?: string | null;
          customer_id?: string | null;
          id?: string | null;
          merchant_id?: string | null;
          status?: string | null;
          tier?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'imei_lookups_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'imei_lookups_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'imei_lookups_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'imei_lookups_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'imei_lookups_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'imei_lookups_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'imei_lookups_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      index_recommendations: {
        Row: {
          idx_scan: number | null;
          priority: string | null;
          recommendation: string | null;
          row_count: number | null;
          schema_name: unknown;
          seq_scan: number | null;
          table_name: unknown;
        };
        Relationships: [];
      };
      low_stock_products: {
        Row: {
          avg_daily_sales: number | null;
          days_of_stock: number | null;
          id: string | null;
          images: Json | null;
          low_stock_threshold: number | null;
          merchant_id: string | null;
          name: string | null;
          predicted_stockout_date: string | null;
          reorder_quantity: number | null;
          sales_trend: string | null;
          stock_quantity: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'products_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'products_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      merchant_health: {
        Row: {
          active_days: number | null;
          business_name: string | null;
          health_status: string | null;
          joined_at: string | null;
          last_order_date: string | null;
          merchant_id: string | null;
          total_gmv: number | null;
          total_orders: number | null;
        };
        Relationships: [];
      };
      petrock_order_customer_status: {
        Row: {
          amount_ngn: number | null;
          amount_usdt: number | null;
          carrier: string | null;
          completed_at: string | null;
          created_at: string | null;
          customer_id: string | null;
          customer_message: string | null;
          device_model: string | null;
          id: string | null;
          merchant_id: string | null;
          paid_at: string | null;
          payment_currency: string | null;
          refund_policy: string | null;
          refunded_at: string | null;
          source_lookup_id: string | null;
          status: string | null;
          status_segment: string | null;
          submitted_at: string | null;
          success_rate: number | null;
          turnaround: string | null;
          updated_at: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'petrock_orders_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'petrock_orders_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'petrock_orders_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'priority_winback_customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'petrock_orders_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'secure_customer_insights';
            referencedColumns: ['customer_id'];
          },
          {
            foreignKeyName: 'petrock_orders_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'petrock_orders_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'petrock_orders_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'petrock_orders_source_lookup_id_fkey';
            columns: ['source_lookup_id'];
            isOneToOne: false;
            referencedRelation: 'imei_lookup_customer_status';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'petrock_orders_source_lookup_id_fkey';
            columns: ['source_lookup_id'];
            isOneToOne: false;
            referencedRelation: 'imei_lookups';
            referencedColumns: ['id'];
          },
        ];
      };
      platform_daily_summary: {
        Row: {
          active_merchants: number | null;
          avg_gmv_per_merchant: number | null;
          platform_gmv: number | null;
          sale_date: string | null;
          total_customers: number | null;
          total_orders: number | null;
        };
        Relationships: [];
      };
      platform_growth: {
        Row: {
          cumulative_merchants: number | null;
          month: string | null;
          new_merchants: number | null;
        };
        Relationships: [];
      };
      platform_revenue: {
        Row: {
          date: string | null;
          gross_gmv: number | null;
          net_to_merchants: number | null;
          platform_fees: number | null;
          processor_fees: number | null;
          total_orders: number | null;
        };
        Relationships: [];
      };
      popular_searches: {
        Row: {
          avg_results: number | null;
          click_through_rate: number | null;
          merchant_id: string | null;
          search_count: number | null;
          search_query: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'search_analytics_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'search_analytics_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'search_analytics_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      priority_winback_customers: {
        Row: {
          churn_risk: number | null;
          days_since_last_order: number | null;
          email: string | null;
          first_name: string | null;
          id: string | null;
          last_name: string | null;
          merchant_id: string | null;
          phone: string | null;
          predicted_clv: number | null;
          rfm_segment: string | null;
          total_orders: number | null;
          total_spent: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_rfm_scores_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customer_rfm_scores_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customer_rfm_scores_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      product_performance: {
        Row: {
          last_sold_at: string | null;
          merchant_id: string | null;
          name: string | null;
          price: number | null;
          product_id: string | null;
          times_sold: number | null;
          total_quantity_sold: number | null;
          total_revenue: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'products_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'products_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      sales_by_channel: {
        Row: {
          avg_order_value: number | null;
          channel: string | null;
          merchant_id: string | null;
          order_count: number | null;
          total_revenue: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'orders_merchant_id_fkey1';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'orders_merchant_id_fkey1';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_merchant_id_fkey1';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      santa_campaign_stats: {
        Row: {
          added_to_cart: number | null;
          avg_discount: number | null;
          conversions: number | null;
          date: string | null;
          merchant_id: string | null;
          total_chats: number | null;
          total_revenue: number | null;
          unique_sessions: number | null;
          wishes_denied: number | null;
          wishes_granted: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'santa_interactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'santa_interactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'santa_interactions_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      secure_customer_insights: {
        Row: {
          avg_order_value: number | null;
          customer_id: string | null;
          email: string | null;
          first_order_date: string | null;
          last_order_date: string | null;
          lifetime_value: number | null;
          merchant_id: string | null;
          name: string | null;
          total_orders: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'customers_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'customers_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'customers_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      secure_daily_sales_summary: {
        Row: {
          avg_order_value: number | null;
          merchant_id: string | null;
          order_count: number | null;
          paid_orders: number | null;
          paid_revenue: number | null;
          pending_orders: number | null;
          sale_date: string | null;
          total_revenue: number | null;
          unique_customers: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'orders_merchant_id_fkey1';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'orders_merchant_id_fkey1';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_merchant_id_fkey1';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      secure_product_performance: {
        Row: {
          last_sold_at: string | null;
          merchant_id: string | null;
          name: string | null;
          price: number | null;
          product_id: string | null;
          times_sold: number | null;
          total_quantity_sold: number | null;
          total_revenue: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'products_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'products_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_merchant_id_fkey';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      secure_sales_by_channel: {
        Row: {
          avg_order_value: number | null;
          channel: string | null;
          merchant_id: string | null;
          order_count: number | null;
          total_revenue: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'orders_merchant_id_fkey1';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchant_health';
            referencedColumns: ['merchant_id'];
          },
          {
            foreignKeyName: 'orders_merchant_id_fkey1';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'merchants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_merchant_id_fkey1';
            columns: ['merchant_id'];
            isOneToOne: false;
            referencedRelation: 'top_merchants';
            referencedColumns: ['merchant_id'];
          },
        ];
      };
      top_merchants: {
        Row: {
          avg_daily_revenue: number | null;
          business_name: string | null;
          joined_at: string | null;
          merchant_id: string | null;
          total_gmv: number | null;
          total_orders: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      accept_staff_invite: {
        Args: { p_email: string; p_token: string };
        Returns: {
          id: string;
          merchant_business_name: string;
          merchant_id: string;
          merchant_slug: string;
          role: Database['public']['Enums']['staff_role'];
          status: string;
        }[];
      };
      acknowledge_recovery_code_set: {
        Args: { p_code_set_id: string; p_user_id: string };
        Returns: boolean;
      };
      refresh_paystack_order_payable_amount: {
        Args: { p_order_id: string };
        Returns: number;
      };
      release_expired_paystack_order_account: {
        Args: { p_order_id: string };
        Returns: boolean;
      };
      reserve_paystack_order_payment_account: {
        Args: {
          p_account_name: string;
          p_account_number: string;
          p_assigned_at: string;
          p_bank_name: string;
          p_expires_at: string;
          p_expected_customer_email: string;
          p_order_id: string;
          p_provisioning_proof: Json;
        };
        Returns: string;
      };
      advance_petrock_eligibility_evidence: {
        Args: {
          p_check_kind: string;
          p_evidence: Json;
          p_order_id: string;
          p_provider_status: string;
        };
        Returns: boolean;
      };
      allocate_customer_savings_contribution: {
        Args: {
          p_amount: number;
          p_customer_id: string;
          p_description?: string;
          p_goal_id: string;
          p_idempotency_key: string;
          p_merchant_id: string;
          p_source_id: string;
          p_source_type: string;
        };
        Returns: {
          contribution_id: string;
          goal_current_amount: number;
          goal_status: string;
          success: boolean;
          wallet_balance: number;
          wallet_transaction_id: string;
        }[];
      };
      app_integrity_tier_rank: { Args: { p_tier: string }; Returns: number };
      apply_ai_storefront_draft: {
        Args: {
          p_force?: boolean;
          p_generated_against_updated_at: string;
          p_generated_config: Json;
          p_job_id: string;
          p_merchant_id: string;
          p_page_slug: string;
        };
        Returns: {
          applied: boolean;
          code: string;
          page_config_id: string;
          updated_at: string;
        }[];
      };
      apply_gigl_tracking_result: {
        Args: {
          p_actual_delivery: string;
          p_current_location: string;
          p_events: Json;
          p_shipment_id: string;
          p_status: string;
          p_tracking_epoch_id: string;
          p_worker_id: string;
        };
        Returns: boolean;
      };
      apply_provider_shipment_webhook_status: {
        Args: {
          p_event_timestamp?: string;
          p_normalized_status: string;
          p_provider: string;
          p_shipment_id: string;
          p_tracking_event?: Json;
          p_tracking_number?: string;
        };
        Returns: Json;
      };
      award_purchase_points: {
        Args: {
          p_customer_id: string;
          p_merchant_id: string;
          p_order_id: string;
          p_order_total: number;
        };
        Returns: number;
      };
      award_vtu_airtime_loyalty_points: {
        Args: { p_points: number; p_transaction_id: string };
        Returns: Json;
      };
      backfill_branch_scope_for_single_active_branch: {
        Args: { p_branch_id: string; p_merchant_id: string };
        Returns: {
          expenses_count: number;
          orders_count: number;
          variant_inventory_count: number;
        }[];
      };
      backfill_merchant_balances: {
        Args: never;
        Returns: {
          rows_updated: number;
          scope: string;
        }[];
      };
      backfill_wallet_balances: {
        Args: never;
        Returns: {
          rows_updated: number;
          scope: string;
        }[];
      };
      begin_merchant_auth_recovery_attempt: {
        Args: {
          p_code_set_id: string;
          p_cutoff: string;
          p_ip_hash: string;
          p_max_failures: number;
          p_user_id: string;
        };
        Returns: string;
      };
      begin_order_notification_outbox_dispatch: {
        Args: {
          p_claim_owner: string;
          p_event_type: string;
          p_merchant_id: string;
          p_order_id: string;
          p_outbox_id: string;
        };
        Returns: number;
      };
      begin_petrock_eligibility_check: {
        Args: {
          p_check_kind: string;
          p_feedback_token_hash: string;
          p_order_id: string;
          p_reference_id: string;
        };
        Returns: boolean;
      };
      begin_petrock_remediation_submission: {
        Args: {
          p_feedback_token_hash: string;
          p_order_id: string;
          p_reference_id: string;
        };
        Returns: boolean;
      };
      begin_shipment_tracking_notification_dispatch: {
        Args: { p_id: string; p_worker_id: string };
        Returns: boolean;
      };
      bind_quiz_attempt_device: {
        Args: {
          p_attempt_id: string;
          p_device_hash: string;
          p_route_proof?: Json;
        };
        Returns: boolean;
      };
      bind_repair_pickup_pending_payment_reference: {
        Args: {
          p_merchant_id: string;
          p_reference: string;
          p_repair_id: string;
        };
        Returns: {
          bound: boolean;
        }[];
      };
      build_product_variant_key: {
        Args: { p_attributes: Json; p_condition: string };
        Returns: string;
      };
      calculate_customer_rfm: {
        Args: { p_customer_id: string; p_merchant_id: string };
        Returns: {
          churn_risk: number;
          frequency_score: number;
          lifecycle_segment: string;
          monetary_score: number;
          predicted_clv: number;
          recency_score: number;
          rfm_segment: string;
        }[];
      };
      calculate_inventory_forecast: {
        Args: {
          p_merchant_id: string;
          p_product_id: string;
          p_variant_id?: string;
        };
        Returns: {
          avg_daily_sales: number;
          current_stock: number;
          days_of_stock: number;
          predicted_stockout_date: string;
          reorder_quantity: number;
          sales_trend: string;
        }[];
      };
      get_inventory_forecast_dashboard: {
        Args: {
          p_limit?: number;
          p_low_stock_only?: boolean;
          p_merchant_id: string;
          p_offset?: number;
        };
        Returns: Json;
      };
      calculate_loyalty_tier: {
        Args: { p_lifetime_points: number; p_merchant_id: string };
        Returns: string;
      };
      calculate_order_check_digit: {
        Args: { order_str: string };
        Returns: string;
      };
      calculate_order_vat: {
        Args: { order_uuid: string };
        Returns: {
          tax_amount: number;
          tax_exclusive_total: number;
          tax_inclusive_total: number;
        }[];
      };
      calculate_settlement_date: {
        Args: { p_gateway: string; p_payment_date?: string };
        Returns: string;
      };
      can_access_order: {
        Args: { p_customer_id: string; p_merchant_id: string };
        Returns: boolean;
      };
      cancel_customer_savings_goal_future_debits: {
        Args: {
          p_actor_id?: string;
          p_customer_id: string;
          p_goal_id: string;
          p_merchant_id: string;
        };
        Returns: {
          goal_status: string;
          success: boolean;
        }[];
      };
      cancel_order_and_release_inventory: {
        Args: {
          p_merchant_id: string;
          p_notes?: string;
          p_order_id: string;
          p_payment_status?: string;
          p_shipping_address?: Json;
        };
        Returns: Json;
      };
      cancel_order_as_customer: {
        Args: { p_order_id: string; p_reason?: string };
        Returns: boolean;
      };
      cancel_order_as_merchant: {
        Args: { p_order_id: string; p_reason?: string };
        Returns: boolean;
      };
      cancel_provider_shipment_order_and_release_inventory: {
        Args: {
          p_cancelled_at?: string;
          p_merchant_id: string;
          p_refund_amount?: number;
          p_shipment_id: string;
        };
        Returns: Json;
      };
      canonicalize_rollout_product_condition: {
        Args: { p_value: string };
        Returns: string;
      };
      check_database_health: {
        Args: never;
        Returns: {
          check_name: string;
          details: Json;
          message: string;
          status: string;
        }[];
      };
      check_rate_limit: {
        Args: {
          endpoint_param: string;
          identifier_param: string;
          max_requests?: number;
          window_minutes?: number;
        };
        Returns: boolean;
      };
      check_staff_permission: {
        Args: {
          p_action: string;
          p_merchant_id: string;
          p_resource: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      authorize_expense_private_receipt_cleanup_deletion: {
        Args: {
          p_expense_id?: string | null;
          p_merchant_id: string;
          p_storage_path: string;
        };
        Returns: boolean;
      };
      authorize_legacy_expense_receipt_cleanup_deletion: {
        Args: {
          p_expense_id: string;
          p_merchant_id: string;
          p_storage_path: string;
        };
        Returns: boolean;
      };
      claim_cache_invalidations: {
        Args: { p_batch_size?: number; p_worker_id?: string };
        Returns: {
          attempts: number;
          claim_token: string;
          generation: number;
          merchant_id: string;
          product_slugs: string[];
          related_identifiers: string[];
          target_id: string;
          target_kind: string;
        }[];
      };
      claim_customer_on_phone_auth: {
        Args: {
          p_first_name?: string;
          p_last_name?: string;
          p_merchant_id: string;
          p_phone: string;
          p_user_id: string;
        };
        Returns: string;
      };
      claim_due_gigl_tracking_monitors: {
        Args: { p_limit: number; p_worker_id: string };
        Returns: {
          order_id: string | null;
          shipment_id: string;
          state: string;
          tracking_epoch_id: string;
          tracking_number: string;
        }[];
      };
      claim_event_deliveries_v1: {
        Args: {
          p_batch_size: number;
          p_lease_seconds?: number;
          p_worker_id: string;
        };
        Returns: {
          attempt_number: number;
          claim_token: string;
          claimed_at: string;
          destination: string;
          domain_event_id: string;
          id: string;
          payload: Json;
        }[];
      };
      claim_expense_private_receipt_cleanup_candidates: {
        Args: { p_limit?: number };
        Returns: {
          expense_id: string | null;
          merchant_id: string;
          storage_path: string;
        }[];
      };
      claim_legacy_expense_receipt_cleanup_candidates: {
        Args: { p_limit?: number };
        Returns: {
          expense_id: string;
          merchant_id: string;
          storage_path: string;
        }[];
      };
      claim_manual_payment_side_effect: {
        Args: {
          p_claim_token: string;
          p_claimed_by: string;
          p_order_id: string;
          p_step: string;
          p_transaction_id: string;
        };
        Returns: {
          current_status: string;
          we_won: boolean;
        }[];
      };
      claim_merchant_auth_recovery_code: {
        Args: {
          p_attempt_id: string;
          p_code_id: string;
          p_code_set_id: string;
          p_ip_hash: string;
          p_replacement_code_hash: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      claim_order_cancellation_side_effect: {
        Args: { p_claim_token: string; p_order_id: string; p_step: string };
        Returns: {
          current_status: string;
          we_won: boolean;
        }[];
      };
      claim_order_notification_outbox: {
        Args: { p_batch_size?: number; p_worker_id?: string };
        Returns: {
          attempt_count: number;
          claim_owner: string;
          event_sequence: number;
          event_type: string;
          id: string;
          max_attempts: number;
          merchant_id: string;
          metadata: Json;
          order_id: string;
        }[];
      };
      claim_order_shipment_booking: {
        Args: {
          p_lock_timeout_seconds?: number;
          p_lock_token: string;
          p_merchant_id: string;
          p_order_id: string;
        };
        Returns: {
          claimed: boolean;
          shipment_id: string;
          shipping_status: string;
          tracking_number: string;
        }[];
      };
      claim_payment_side_effect: {
        Args: {
          p_claim_token: string;
          p_claimed_by: string;
          p_order_id: string;
          p_step: string;
          p_transaction_id: string;
        };
        Returns: {
          current_status: string;
          we_won: boolean;
        }[];
      };
      claim_paystack_paid_atomic: {
        Args: {
          p_cancel_order_ids?: string[];
          p_canonical_order_id: string;
          p_gateway_response: Json;
          p_operator_label?: string;
          p_operator_user_id: string;
          p_paystack_reference: string;
          p_transaction_id: string;
        };
        Returns: Json;
      };
      claim_petrock_imei_lookup_poll: {
        Args: {
          p_customer_id: string;
          p_lease_seconds?: number;
          p_lease_token: string;
          p_lookup_id: string;
          p_merchant_id: string;
        };
        Returns: {
          id: string;
          identifier_ciphertext: string;
          lease_token: string;
          provider_order_id: string;
          status: string;
          tier: string;
        }[];
      };
      claim_petrock_imei_lookups: {
        Args: {
          p_lease_seconds?: number;
          p_lease_token?: string;
          p_limit?: number;
        };
        Returns: {
          amount_ngn: number;
          customer_id: string;
          id: string;
          identifier_ciphertext: string;
          lease_token: string;
          merchant_id: string;
          provider_attempt_started_at: string;
          provider_order_id: string;
          reconcile_attempts: number;
          status: string;
          tier: string;
        }[];
      };
      claim_petrock_remediation_notification: {
        Args: {
          p_channel: string;
          p_claim_token: string;
          p_lease_seconds?: number;
          p_order_id: string;
        };
        Returns: boolean;
      };
      claim_petrock_remediation_orders: {
        Args: {
          p_lease_seconds?: number;
          p_lease_token: string;
          p_limit?: number;
        };
        Returns: {
          amount_ngn: number | null;
          amount_usdt: number | null;
          carrier: string | null;
          completed_at: string | null;
          cost_usd: number | null;
          created_at: string;
          customer_id: string;
          customer_message: string | null;
          device_model: string | null;
          eligibility_checks_completed: string[];
          eligibility_evidence: Json;
          eligibility_next_check: string | null;
          email_notification_claim_token: string | null;
          email_notification_claim_until: string | null;
          email_notified_at: string | null;
          failure_reason: string | null;
          feedback_token_hash: string | null;
          fx_rate_used: number | null;
          id: string;
          identifier_ciphertext: string | null;
          identifier_hash: string;
          in_app_notified_at: string | null;
          merchant_id: string;
          next_poll_at: string | null;
          paid_at: string | null;
          payment_currency: string | null;
          provider_attempt_started_at: string | null;
          provider_order_id: string | null;
          provider_reference_id: string | null;
          provider_status: string | null;
          push_notification_claim_token: string | null;
          push_notification_claim_until: string | null;
          push_notified_at: string | null;
          reconcile_attempts: number;
          reconcile_lease_token: string | null;
          reconcile_lease_until: string | null;
          refund_policy: string | null;
          refunded_at: string | null;
          remediation_product_id: string | null;
          source_lookup_id: string;
          status: string;
          status_segment: string | null;
          submitted_at: string | null;
          success_rate: number | null;
          turnaround: string | null;
          updated_at: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'petrock_orders';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_quiz_award_cash: {
        Args: {
          p_award_id: string;
          p_production_approved?: boolean;
          p_route_proof?: Json;
        };
        Returns: boolean;
      };
      claim_quiz_award_grand: {
        Args: {
          p_award_id: string;
          p_production_approved?: boolean;
          p_route_proof?: Json;
        };
        Returns: boolean;
      };
      claim_quiz_cash_award: {
        Args: { p_award_id: string; p_server_proof?: Json; p_user_id?: string };
        Returns: Json;
      };
      claim_quiz_grand_prize: {
        Args: { p_event_id: string; p_server_proof?: Json; p_user_id?: string };
        Returns: Json;
      };
      claim_repair_pickup_booking: {
        Args: {
          p_lock_timeout_seconds?: number;
          p_lock_token: string;
          p_merchant_id: string;
          p_repair_id: string;
        };
        Returns: {
          claimed: boolean;
          shipment_id: string;
          terminal: boolean;
        }[];
      };
      claim_shipment_tracking_notifications: {
        Args: { p_limit: number; p_worker_id: string };
        Returns: {
          attempt_count: number;
          audience: string;
          id: string;
          max_attempts: number;
          merchant_id: string;
          notification_kind: string;
          order_id: string | null;
          repair_id: string | null;
          shipment_id: string;
          tracking_epoch_id: string;
          tracking_event_id: string;
        }[];
      };
      claim_variant_inventory_units_for_order_item: {
        Args: {
          p_merchant_id: string;
          p_order_id: string;
          p_order_item_id: string;
        };
        Returns: Json;
      };
      claim_vtu_customer_email_metadata_flag: {
        Args: {
          p_attempt_key: string;
          p_sent_key: string;
          p_transaction_id: string;
        };
        Returns: Json;
      };
      claim_vtu_customer_email_notification_attempt:
        | { Args: { p_transaction_id: string }; Returns: Json }
        | {
            Args: {
              p_attempt_key: string;
              p_sent_key: string;
              p_transaction_id: string;
            };
            Returns: Json;
          };
      claim_vtu_customer_notification_attempt: {
        Args: { p_transaction_id: string };
        Returns: Json;
      };
      claim_wallet_credit_push: {
        Args: { p_transaction_id: string };
        Returns: boolean;
      };
      claim_wallet_credit_push_v2: {
        Args: {
          p_allow_initial_claim: boolean;
          p_claim_token: string;
          p_transaction_id: string;
        };
        Returns: boolean;
      };
      cleanup_credit_direct_checkout_tokens: {
        Args: { p_limit?: number };
        Returns: number;
      };
      cleanup_database_retention: {
        Args: {
          p_analytics_low_value_retention?: string;
          p_cron_retention?: string;
          p_pg_net_retention?: string;
        };
        Returns: {
          analytics_events_deleted: number;
          cron_job_run_details_deleted: number;
          pg_net_responses_deleted: number;
        }[];
      };
      cleanup_domain_event_pipeline_v1: {
        Args: {
          p_delivered_attempt_retention?: string;
          p_queue_archive_retention?: string;
        };
        Returns: {
          delivery_attempts_deleted: number;
          queue_archive_messages_deleted: number;
        }[];
      };
      cleanup_expired_notifications: { Args: never; Returns: undefined };
      cleanup_expired_shipping_quotes: { Args: never; Returns: undefined };
      claim_scheduled_admin_notifications_v1: {
        Args: { p_limit?: number };
        Returns: {
          action_label: string | null;
          action_url: string | null;
          channels: Json;
          created_at: string;
          delivery_claim_token: string;
          expires_at: string | null;
          id: string;
          message: string;
          notification_type: string;
          priority: string;
          scheduled_for: string;
          target_merchant_ids: string[];
          target_segment: string | null;
          target_type: string;
          title: string;
        }[];
      };
      cleanup_old_oauth_handoff_tickets: { Args: never; Returns: undefined };
      cleanup_old_push_attempts: { Args: never; Returns: number };
      cleanup_old_push_tickets: { Args: never; Returns: number };
      cleanup_rate_limit_logs: {
        Args: { retention_interval: string };
        Returns: undefined;
      };
      cleanup_stale_push_tokens: { Args: never; Returns: number };
      clear_merchant_virtual_terminal_code: {
        Args: { p_code: string; p_merchant_id: string };
        Returns: undefined;
      };
      clear_petrock_remediation_notification: {
        Args: { p_channel: string; p_claim_token: string; p_order_id: string };
        Returns: boolean;
      };
      clear_vtu_customer_email_notification_attempt: {
        Args: {
          p_attempt_key: string;
          p_sent_key: string;
          p_transaction_id: string;
        };
        Returns: Json;
      };
      close_due_product_quiz_events: { Args: never; Returns: number };
      compact_product_search_text: {
        Args: { search_text: string };
        Returns: string;
      };
      complete_expense_private_receipt_cleanup: {
        Args: {
          p_expense_id?: string | null;
          p_merchant_id: string;
          p_storage_path: string;
        };
        Returns: boolean;
      };
      complete_legacy_expense_receipt_cleanup: {
        Args: {
          p_expense_id: string;
          p_merchant_id: string;
          p_storage_path: string;
        };
        Returns: boolean;
      };
      complete_order_gateway_payment: {
        Args: {
          p_actor?: string;
          p_gateway_response?: Json;
          p_order_id: string;
          p_transaction_id: string;
        };
        Returns: Json;
      };
      complete_order_notification_outbox_manual_result: {
        Args: {
          p_claim_owner?: string;
          p_event_type: string;
          p_merchant_id: string;
          p_message_id?: string;
          p_order_id: string;
          p_outbox_id?: string;
          p_skip_reason?: string;
          p_status: string;
        };
        Returns: number;
      };
      complete_order_shipment_with_inventory: {
        Args: {
          p_external_units?: Json;
          p_merchant_id: string;
          p_order_id: string;
          p_shipping_update?: Json;
        };
        Returns: Json;
      };
      complete_petrock_remediation_notification: {
        Args: { p_channel: string; p_claim_token: string; p_order_id: string };
        Returns: boolean;
      };
      complete_shipment_tracking_notification: {
        Args: {
          p_error?: string;
          p_id: string;
          p_outcome: string;
          p_worker_id: string;
        };
        Returns: boolean;
      };
      complete_wallet_withdrawal: {
        Args: {
          p_success: boolean;
          p_transaction_id: string;
          p_transfer_message?: string;
          p_transfer_reference?: string;
        };
        Returns: boolean;
      };
      condition_rank: { Args: { p_condition: string }; Returns: number };
      confirm_customer_savings_authorization: {
        Args: {
          p_customer_id: string;
          p_merchant_id: string;
          p_reference: string;
        };
        Returns: {
          saved_payment_method_id: string;
          status: string;
        }[];
      };
      confirm_order_inventory_reservations: {
        Args: { p_merchant_id: string; p_order_id: string };
        Returns: Json;
      };
      confirm_repair_pickup_payment: {
        Args: {
          p_amount: number;
          p_currency: string;
          p_gateway_response: Json;
          p_merchant_id: string;
          p_reference: string;
          p_repair_id: string;
        };
        Returns: {
          confirmed: boolean;
        }[];
      };
      convert_chat_order_to_paid_order_with_inventory: {
        Args: {
          p_amount: number;
          p_chat_order_id: string;
          p_currency: string;
          p_gateway: string;
          p_reference: string;
        };
        Returns: Json;
      };
      create_admin_notification_recipients_v1: {
        Args: { p_merchant_ids: string[]; p_notification_id: string };
        Returns: number;
      };
      create_claimed_admin_notification_recipients_v1: {
        Args: {
          p_claim_token: string;
          p_merchant_ids: string[];
          p_notification_id: string;
        };
        Returns: number;
      };
      create_customer_savings_authorization_transaction: {
        Args: {
          p_amount: number;
          p_customer_id: string;
          p_merchant_id: string;
          p_reference: string;
        };
        Returns: string;
      };
      create_customer_savings_goal: {
        Args: {
          p_auto_debit_authorized_at: string;
          p_break_fee_percent: number;
          p_contribution_amount: number;
          p_contribution_frequency: string;
          p_customer_id: string;
          p_early_end_fee_accepted_at: string;
          p_initial_contribution_amount: number;
          p_initial_contribution_idempotency_key: string;
          p_maturity_date: string;
          p_merchant_id: string;
          p_metadata: Json;
          p_non_withdrawable_accepted_at: string;
          p_preferred_debit_time: string;
          p_product_id: string;
          p_product_snapshot: Json;
          p_saved_payment_method_id: string;
          p_source_mode: string;
          p_start_date: string;
          p_target_amount: number;
          p_terms_accepted_at: string;
          p_title: string;
          p_variant_id: string;
        };
        Returns: {
          contribution_id: string;
          current_amount: number;
          goal_id: string;
          goal_status: string;
          success: boolean;
          wallet_balance: number;
        }[];
      };
      create_domain_purchase_transaction: {
        Args: {
          p_amount: number;
          p_category: string;
          p_cost_price: number;
          p_currency: string;
          p_domain: string;
          p_gateway: string;
          p_merchant_id: string;
          p_reference: string;
          p_sell_price: number;
          p_tld: string;
          p_user_id: string;
          p_years: number;
        };
        Returns: string;
      };
      create_merchant_quiz_draft: {
        Args: {
          p_merchant_id: string;
          p_settings: Json;
          p_slots: Json;
          p_slug: string;
          p_title: string;
          p_variants: Json;
        };
        Returns: {
          id: string;
          slug: string;
          status: string;
          title: string;
        }[];
      };
      create_order_wallet_funding_intent_for_customer: {
        Args: {
          p_customer_id: string;
          p_merchant_id: string;
          p_now?: string;
          p_order_id: string;
          p_wallet_payment_account_id: string;
        };
        Returns: {
          created_at: string;
          currency: string;
          customer_id: string;
          debited_amount: number;
          excess_amount: number;
          expected_amount: number;
          expires_at: string;
          funded_amount: number;
          id: string;
          idempotency_key: string;
          last_gateway_reference: string;
          last_transaction_id: string;
          merchant_id: string;
          order_id: string;
          provider: string;
          status: string;
          target_order_amount: number;
          wallet_balance_snapshot: number;
          wallet_payment_account_id: string;
        }[];
      };
      create_payment_transaction: {
        Args: {
          p_amount: number;
          p_currency: string;
          p_customer_email: string;
          p_customer_name: string;
          p_gateway: string;
          p_merchant_amount: number;
          p_merchant_id: string;
          p_metadata?: Json;
          p_order_id: string;
          p_platform_fee: number;
          p_reference: string;
          p_session_id?: string;
        };
        Returns: string;
      };
      create_receipt_claim_for_import_notification: {
        Args: {
          p_customer_email: string;
          p_customer_id: string;
          p_customer_name: string;
          p_import_job_id: string;
          p_merchant_id: string;
          p_order_ids: string[];
          p_token_hash: string;
        };
        Returns: Json;
      };
      create_recovery_code_set: {
        Args: { p_code_hashes: string[]; p_user_id: string };
        Returns: string;
      };
      create_repair_booking: {
        Args: {
          p_customer_email: string;
          p_customer_name: string;
          p_customer_phone: string;
          p_device_id?: string;
          p_device_model: string;
          p_device_type: string;
          p_issue_description: string;
          p_merchant_id: string;
          p_pickup_address?: string;
          p_preferred_date?: string;
          p_quote_id?: string;
          p_service_type?: string;
        };
        Returns: {
          id: string;
          ticket_number: number;
        }[];
      };
      create_storefront_order: {
        Args: {
          p_ad_tracking?: Json;
          p_checkout_idempotency_key?: string;
          p_checkout_request_hash?: string;
          p_customer_email: string;
          p_customer_name: string;
          p_customer_phone?: string;
          p_discount_amount?: number;
          p_expected_total?: number;
          p_gift_wrapping_fee?: number;
          p_items: Json;
          p_merchant_id: string;
          p_notes?: string;
          p_payment_method?: string;
          p_payment_status?: string;
          p_selected_quote_id?: string;
          p_shipping_address?: Json;
          p_shipping_fee?: number;
          p_shipping_provider?: string;
          p_shipping_status?: string;
          p_source?: string;
          p_tax_amount?: number;
          p_tax_basis?: string;
          p_tracking_number?: string;
          p_user_id?: string;
        };
        Returns: {
          customer_email: string;
          customer_id: string;
          customer_name: string;
          customer_phone: string;
          discount_amount: number;
          gift_wrapping_fee: number;
          id: string;
          idempotency_replayed: boolean;
          merchant_id: string;
          order_number: string;
          payment_method: string;
          payment_status: string;
          shipping_address: Json;
          shipping_fee: number;
          shipping_status: string;
          subtotal: number;
          tax_amount: number;
          tax_basis: string;
          total: number;
          tracking_token: string;
        }[];
      };
      create_storefront_order_with_discount_code: {
        Args: {
          p_ad_tracking?: Json;
          p_checkout_idempotency_key?: string;
          p_checkout_request_hash?: string;
          p_customer_email: string;
          p_customer_name: string;
          p_customer_phone?: string;
          p_discount_amount?: number;
          p_discount_code_id?: string;
          p_expected_total?: number;
          p_gift_wrapping_fee?: number;
          p_items: Json;
          p_merchant_id: string;
          p_notes?: string;
          p_payment_method?: string;
          p_payment_status?: string;
          p_selected_quote_id?: string;
          p_shipping_address?: Json;
          p_shipping_fee?: number;
          p_shipping_provider?: string;
          p_shipping_status?: string;
          p_source?: string;
          p_tax_amount?: number;
          p_tax_basis?: string;
          p_tracking_number?: string;
          p_user_id?: string;
        };
        Returns: {
          customer_email: string;
          customer_id: string;
          customer_name: string;
          customer_phone: string;
          discount_amount: number;
          gift_wrapping_fee: number;
          id: string;
          idempotency_replayed: boolean;
          merchant_id: string;
          order_number: string;
          payment_method: string;
          payment_status: string;
          shipping_address: Json;
          shipping_fee: number;
          shipping_status: string;
          subtotal: number;
          tax_amount: number;
          tax_basis: string;
          total: number;
          tracking_token: string;
        }[];
      };
      create_storefront_order_with_quiz_voucher: {
        Args: {
          p_ad_tracking?: Json;
          p_customer_email: string;
          p_customer_name: string;
          p_customer_phone?: string;
          p_discount_amount?: number;
          p_expected_total?: number;
          p_gift_wrapping_fee?: number;
          p_items: Json;
          p_merchant_id: string;
          p_notes?: string;
          p_payment_method?: string;
          p_payment_status?: string;
          p_route_proof?: Json;
          p_selected_quote_id?: string;
          p_shipping_address?: Json;
          p_shipping_fee?: number;
          p_shipping_provider?: string;
          p_shipping_status?: string;
          p_source?: string;
          p_tax_amount?: number;
          p_tax_basis?: string;
          p_tracking_number?: string;
          p_user_id?: string;
        };
        Returns: {
          customer_email: string;
          customer_id: string;
          customer_name: string;
          customer_phone: string;
          discount_amount: number;
          gift_wrapping_fee: number;
          id: string;
          merchant_id: string;
          order_number: string;
          payment_method: string;
          payment_status: string;
          shipping_address: Json;
          shipping_fee: number;
          shipping_status: string;
          subtotal: number;
          tax_amount: number;
          tax_basis: string;
          total: number;
          tracking_token: string;
        }[];
      };
      create_storefront_order_with_savings: {
        Args: {
          p_ad_tracking?: Json;
          p_checkout_idempotency_key?: string;
          p_checkout_request_hash?: string;
          p_customer_email: string;
          p_customer_name: string;
          p_customer_phone?: string;
          p_discount_amount?: number;
          p_expected_total?: number;
          p_gift_wrapping_fee?: number;
          p_items: Json;
          p_merchant_id: string;
          p_notes?: string;
          p_payment_method?: string;
          p_payment_status?: string;
          p_savings_amount?: number;
          p_savings_goal_id?: string;
          p_savings_idempotency_key?: string;
          p_selected_quote_id?: string;
          p_shipping_address?: Json;
          p_shipping_fee?: number;
          p_shipping_provider?: string;
          p_shipping_status?: string;
          p_source?: string;
          p_tax_amount?: number;
          p_tax_basis?: string;
          p_tracking_number?: string;
          p_user_id?: string;
        };
        Returns: {
          customer_email: string;
          customer_id: string;
          customer_name: string;
          customer_phone: string;
          discount_amount: number;
          gift_wrapping_fee: number;
          id: string;
          idempotency_replayed: boolean;
          merchant_id: string;
          order_number: string;
          payment_method: string;
          payment_status: string;
          savings_goal_id: string;
          savings_goal_status: string;
          savings_redeemed_amount: number;
          savings_redemption_id: string;
          savings_redemption_success: boolean;
          shipping_address: Json;
          shipping_fee: number;
          shipping_status: string;
          subtotal: number;
          tax_amount: number;
          tax_basis: string;
          total: number;
          tracking_token: string;
        }[];
      };
      credit_customer_wallet: {
        Args: {
          p_amount: number;
          p_customer_id: string;
          p_description?: string;
          p_merchant_id: string;
          p_source_id: string;
          p_source_type: string;
        };
        Returns: {
          new_balance: number;
          success: boolean;
          transaction_id: string;
        }[];
      };
      credit_customer_wallet_account: {
        Args: {
          p_amount: number;
          p_currency: string;
          p_customer_id: string;
          p_description?: string;
          p_merchant_id: string;
          p_source_id: string;
          p_source_type: string;
        };
        Returns: {
          currency: string;
          new_balance: number;
          success: boolean;
          transaction_id: string;
        }[];
      };
      credit_merchant_wallet: {
        Args: {
          p_amount: number;
          p_description?: string;
          p_merchant_id: string;
          p_source_id: string;
          p_source_type: string;
        };
        Returns: {
          new_balance: number;
          transaction_id: string;
          wallet_id: string;
        }[];
      };
      current_agentic_merchant_id: { Args: never; Returns: string };
      current_agentic_session_id: { Args: never; Returns: string };
      current_user_has_platform_admin_permission_v1: {
        Args: { p_permission: string };
        Returns: boolean;
      };
      customer_order_can_cancel: {
        Args: { p_order_id: string };
        Returns: boolean;
      };
      deactivate_branch: {
        Args: { p_branch_id: string };
        Returns: {
          active: boolean | null;
          address: string | null;
          city: string | null;
          created_at: string | null;
          id: string;
          is_default: boolean | null;
          manager_id: string | null;
          merchant_id: string;
          name: string;
          phone: string | null;
          state: string | null;
          updated_at: string | null;
        };
        SetofOptions: {
          from: '*';
          to: 'branches';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      deactivate_push_token: { Args: { p_token: string }; Returns: boolean };
      dead_letter_ingress_event_v1: {
        Args: {
          p_domain_event_id: string;
          p_failure_code: string;
          p_failure_message: string;
          p_original_envelope: Json;
          p_parser_version?: number;
          p_queue_message_id: number;
        };
        Returns: string;
      };
      debit_merchant_wallet: {
        Args: {
          p_amount: number;
          p_description?: string;
          p_merchant_id: string;
          p_type: string;
        };
        Returns: {
          error_message: string;
          new_balance: number;
          success: boolean;
          transaction_id: string;
          wallet_id: string;
        }[];
      };
      decrement_product_stock: {
        Args: { product_id_param: string; quantity_param: number };
        Returns: {
          message: string;
          new_stock: number;
          success: boolean;
        }[];
      };
      decrement_variant_stock: {
        Args: { quantity_param: number; variant_id_param: string };
        Returns: {
          message: string;
          new_stock: number;
          success: boolean;
        }[];
      };
      delete_current_storefront_account: { Args: never; Returns: undefined };
      delete_legacy_expense_receipt: {
        Args: {
          p_expense_id: string;
          p_merchant_id: string;
          p_storage_path: string;
        };
        Returns: boolean;
      };
      delete_merchant_payment_credential: {
        Args: { p_merchant_id: string; p_provider: string };
        Returns: undefined;
      };
      delete_merchant_payment_credential_role: {
        Args: {
          p_credential_role: string;
          p_environment: string;
          p_merchant_id: string;
          p_provider: string;
        };
        Returns: undefined;
      };
      delete_variant_inventory_unit: {
        Args: { p_merchant_id: string; p_unit_id: string };
        Returns: Json;
      };
      encode_base32_crockford: { Args: { num: number }; Returns: string };
      enqueue_cache_invalidation_target: {
        Args: {
          p_merchant_id: string;
          p_product_slugs?: string[];
          p_related_identifiers?: string[];
          p_target_id: string;
          p_target_kind: string;
        };
        Returns: undefined;
      };
      enqueue_domain_event_v1: {
        Args: {
          p_causation_id?: string;
          p_changed_fields?: string[];
          p_correlation_id?: string;
          p_data: Json;
          p_event_name: string;
          p_external_event_id: string;
          p_idempotency_key: string;
          p_merchant_id: string;
          p_metadata: Json;
          p_occurred_at?: string;
          p_producer: string;
          p_source: Json;
          p_subject_id: string;
          p_subject_type: string;
          p_trust_level: string;
        };
        Returns: {
          already_enqueued: boolean;
          domain_event_id: string;
          queue_message_id: number;
        }[];
      };
      enqueue_storefront_cache_targets: {
        Args: {
          p_additional_hostname?: string;
          p_additional_slug?: string;
          p_merchant_id: string;
          p_product_slugs?: string[];
        };
        Returns: undefined;
      };
      enqueue_storefront_product_cache_target: {
        Args: { p_merchant_id: string; p_product_identifier: string };
        Returns: undefined;
      };
      expire_order_wallet_funding_intents: {
        Args: {
          p_customer_id?: string;
          p_merchant_id?: string;
          p_now?: string;
          p_wallet_payment_account_id?: string;
        };
        Returns: undefined;
      };
      expire_unclaimed_ranked_quiz_awards_v2: { Args: never; Returns: Json };
      extract_primary_image_from_jsonb: {
        Args: { p_images: Json };
        Returns: string;
      };
      extract_variant_color: { Args: { p_attributes: Json }; Returns: string };
      extract_variant_color_key: {
        Args: { p_attributes: Json };
        Returns: string;
      };
      fail_customer_savings_authorization_transaction: {
        Args: {
          p_customer_id: string;
          p_failure_message: string;
          p_merchant_id: string;
          p_reference: string;
        };
        Returns: boolean;
      };
      fail_petrock_remediation_before_acceptance: {
        Args: {
          p_customer_message: string;
          p_order_id: string;
          p_reason: string;
        };
        Returns: boolean;
      };
      file_wallet_order_funding_ambiguous_review: {
        Args: {
          p_gateway_reference: string;
          p_intent_ids: string[];
          p_reason?: string;
        };
        Returns: undefined;
      };
      finalize_due_live_quiz_events_v2: {
        Args: { p_production_approved: boolean; p_production_phase: boolean };
        Returns: Json;
      };
      finalize_due_quiz_events: { Args: never; Returns: number };
      finalize_due_test_quiz_events_v2: { Args: never; Returns: Json };
      finalize_scheduled_admin_notification_v1: {
        Args: {
          p_claim_token: string;
          p_error?: string;
          p_notification_id: string;
          p_outcome: string;
        };
        Returns: boolean;
      };
      finalize_petrock_imei_lookup: {
        Args: {
          p_cached_response: Json;
          p_cached_status: number;
          p_lease_token?: string;
          p_lookup_id: string;
          p_provider_status: string;
          p_response_hash?: string;
          p_terminal_status: string;
        };
        Returns: boolean;
      };
      finalize_petrock_remediation_order: {
        Args: {
          p_customer_message: string;
          p_failure_reason?: string;
          p_order_id: string;
          p_provider_status: string;
          p_success: boolean;
        };
        Returns: boolean;
      };
      finalize_quiz_awards: {
        Args: {
          p_attempt_id: string;
          p_event_id: string;
          p_server_proof?: Json;
          p_user_id?: string;
        };
        Returns: number;
      };
      finalize_quiz_event_awards: {
        Args: {
          p_event_id: string;
          p_production_approved?: boolean;
          p_route_proof?: Json;
        };
        Returns: number;
      };
      finalize_quiz_voucher_order_payment: {
        Args: { p_award_id: string; p_order_id: string };
        Returns: boolean;
      };
      finalize_store_credit_order_payment: {
        Args: {
          p_amount: number;
          p_order_id: string;
          p_payment_method: string;
        };
        Returns: boolean;
      };
      finalize_wallet_funded_order: {
        Args: {
          p_currency?: string;
          p_gateway_fee?: number;
          p_gateway_reference: string;
          p_intent_id: string;
          p_paid_at?: string;
          p_received_amount: number;
          p_transaction_id: string;
        };
        Returns: {
          credited_amount: number;
          debited_amount: number;
          excess_amount: number;
          funded_amount: number;
          order_id: string;
          order_paid: boolean;
          order_payment_transaction_id: string;
          wallet_credit_transaction_id: string;
          wallet_debit_transaction_id: string;
        }[];
      };
      finalize_wallet_order_payment: {
        Args: { p_amount: number; p_order_id: string };
        Returns: boolean;
      };
      find_nearest_shipping_service_centres: {
        Args: {
          p_latitude: number;
          p_limit?: number;
          p_longitude: number;
          p_provider: string;
        };
        Returns: {
          address: string;
          distance_metres: number;
          latitude: number;
          longitude: number;
          service_centre_code: string;
          service_centre_id: number;
          service_centre_name: string;
          source_synced_at: string;
          station_code: string;
          station_id: number;
          station_name: string;
        }[];
      };
      find_product_search_suggestion_v2: {
        Args: {
          merchant_id_param: string;
          search_term: string;
          similarity_threshold?: number;
        };
        Returns: {
          similarity_score: number;
          suggested_term: string;
        };
      };
      find_resumable_repair_pickup: {
        Args: {
          p_customer_email: string;
          p_merchant_id: string;
          p_repair_id?: string;
        };
        Returns: {
          customer_phone: string;
          device_model: string;
          device_type: string;
          id: string;
          pickup_address: string | null;
          ticket_number: number;
        }[];
      };
      find_spelling_suggestion: {
        Args: {
          merchant_id_param: string;
          search_term: string;
          similarity_threshold?: number;
        };
        Returns: {
          similarity_score: number;
          suggested_term: string;
        }[];
      };
      finish_cache_invalidation: {
        Args: {
          p_claim_token: string;
          p_error_code?: string;
          p_generation: number;
          p_merchant_id: string;
          p_retry_after_seconds?: number;
          p_succeeded: boolean;
          p_target_id: string;
          p_target_kind: string;
        };
        Returns: boolean;
      };
      finish_event_delivery_v1: {
        Args: {
          p_available_at?: string;
          p_claim_token: string;
          p_delivery_id: string;
          p_error_code?: string;
          p_error_message?: string;
          p_http_status?: number;
          p_outcome: string;
          p_provider_response_id?: string;
        };
        Returns: boolean;
      };
      finish_manual_payment_side_effect: {
        Args: {
          p_claim_token: string;
          p_error: string;
          p_status: string;
          p_step: string;
          p_transaction_id: string;
        };
        Returns: boolean;
      };
      finish_order_cancellation_side_effect: {
        Args: {
          p_claim_token: string;
          p_error?: string;
          p_order_id: string;
          p_result?: Json;
          p_status: string;
          p_step: string;
        };
        Returns: boolean;
      };
      format_merchant_address: { Args: { p_address: Json }; Returns: string };
      format_order_item_variant_name: {
        Args: { p_attributes: Json };
        Returns: string;
      };
      generate_improved_order_number: {
        Args: { merchant_uuid: string };
        Returns: string;
      };
      generate_inventory_snapshot: {
        Args: { p_merchant_id: string };
        Returns: number;
      };
      generate_order_number_for_merchant: {
        Args: { merchant_uuid: string };
        Returns: string;
      };
      generate_slug: { Args: { text_input: string }; Returns: string };
      get_active_banners: {
        Args: { p_merchant_id: string };
        Returns: {
          action_label: string;
          action_url: string;
          created_at: string;
          id: string;
          message: string;
          notification_id: string;
          notification_type: string;
          priority: string;
          title: string;
        }[];
      };
      get_admin_merchant_360: {
        Args: { p_merchant_id: string };
        Returns: Json;
      };
      get_admin_merchant_360_v2: {
        Args: { p_merchant_id: string };
        Returns: Json;
      };
      get_admin_merchant_health: {
        Args: never;
        Returns: {
          active_days: number;
          business_name: string;
          email: string;
          health_status: string;
          joined_at: string;
          last_order_date: string;
          merchant_id: string;
          storefront_slug: string;
          total_gmv: number;
          total_orders: number;
        }[];
      };
      get_admin_merchant_health_v2: {
        Args: {
          p_health_status?: string | null;
          p_limit?: number;
          p_offset?: number;
          p_search?: string | null;
          p_sort_by?: string;
        };
        Returns: {
          active_days: number;
          business_name: string | null;
          email: string | null;
          excluded_non_ngn_or_unknown_paid_orders: number;
          health_status: string;
          joined_at: string;
          last_order_date: string | null;
          merchant_id: string;
          storefront_slug: string | null;
          total_count: number;
          total_gmv: number;
          total_orders: number;
        }[];
      };
      get_admin_merchant_profiles: { Args: never; Returns: Json };
      get_admin_notification_dashboard: {
        Args: {
          p_priority?: string;
          p_search?: string;
          p_status?: string;
          p_type?: string;
        };
        Returns: Json;
      };
      get_admin_notification_detail: {
        Args: { p_notification_id: string };
        Returns: Json;
      };
      get_admin_notification_segment_merchant_ids: {
        Args: { p_segment: string };
        Returns: string[];
      };
      get_admin_notification_stats_batch: {
        Args: { p_notification_ids: string[] };
        Returns: {
          notification_id: string;
          read_rate: number;
          total_dismissed: number;
          total_read: number;
          total_sent: number;
        }[];
      };
      get_follow_up_notification_preference: {
        Args: { p_order_id: string };
        Returns: boolean;
      };
      get_scheduled_notification_recipient_page_v1: {
        Args: {
          p_after_merchant_id?: string;
          p_claim_token: string;
          p_limit?: number;
          p_notification_id: string;
        };
        Returns: { merchant_id: string }[];
      };
      get_scheduled_notification_worker_health_v1: {
        Args: never;
        Returns: Json;
      };
      get_notification_push_outbox_summary_v1: {
        Args: { p_claim_token: string; p_notification_id: string };
        Returns: Json;
      };
      get_admin_operations_v1: {
        Args: { p_limit?: number; p_offset?: number; p_section?: string };
        Returns: Json;
      };
      get_admin_operations_v2: {
        Args: { p_limit?: number; p_offset?: number; p_section?: string };
        Returns: Json;
      };
      get_admin_platform_settings_v1: { Args: never; Returns: Json };
      get_admin_platform_analytics: {
        Args: { p_period?: string };
        Returns: Json;
      };
      get_admin_platform_daily_summary: {
        Args: { p_end_date?: string; p_start_date?: string };
        Returns: {
          active_merchants: number;
          avg_gmv_per_merchant: number;
          platform_gmv: number;
          sale_date: string;
          total_customers: number;
          total_orders: number;
        }[];
      };
      get_admin_platform_growth: {
        Args: { p_limit?: number };
        Returns: {
          month: string;
          new_merchants: number;
        }[];
      };
      get_admin_reconciliation: {
        Args: {
          p_currency?: string;
          p_cursor_created_at?: string;
          p_cursor_id?: string;
          p_lane?: string;
          p_limit?: number;
          p_merchant_id?: string;
          p_period?: string;
          p_status?: string;
        };
        Returns: Json;
      };
      get_admin_reconciliation_v2: {
        Args: {
          p_currency?: string | null;
          p_cursor_created_at?: string | null;
          p_cursor_id?: string | null;
          p_lane?: string | null;
          p_limit?: number | null;
          p_merchant_id?: string | null;
          p_period?: string | null;
          p_status?: string | null;
        };
        Returns: Json;
      };
      get_admin_reconciliation_v3: {
        Args: {
          p_currency?: string | null;
          p_cursor_created_at?: string | null;
          p_cursor_id?: string | null;
          p_lane?: string | null;
          p_limit?: number | null;
          p_merchant_id?: string | null;
          p_period?: string | null;
          p_status?: string | null;
        };
        Returns: Json;
      };
      get_admin_system_health_v1: { Args: never; Returns: Json };
      get_admin_top_merchants: {
        Args: never;
        Returns: {
          avg_daily_revenue: number;
          business_name: string;
          joined_at: string;
          merchant_id: string;
          total_gmv: number;
          total_orders: number;
        }[];
      };
      get_agentic_action_health_records: {
        Args: { p_merchant_id: string; p_record_limit?: number };
        Returns: Json;
      };
      get_analytics_summary: {
        Args: {
          p_end_date: string;
          p_merchant_id: string;
          p_start_date: string;
        };
        Returns: Json;
      };
      get_checkout_shipping_quote: {
        Args: { p_merchant_id: string; p_quote_id: string };
        Returns: {
          expires_at: string;
          merchant_id: string;
          price: number;
          provider: string;
          provider_rate_id: string;
          quote_request: Json;
        }[];
      };
      get_customer_order_transactions: {
        Args: { p_order_ids: string[] };
        Returns: {
          amount: number | null;
          created_at: string;
          description: string | null;
          dva_account_number: string | null;
          gateway: string | null;
          id: string;
          order_id: string;
          status: string | null;
          transaction_type: string | null;
        }[];
      };
      get_customer_order_payment_accounts: {
        Args: { p_order_ids: string[] };
        Returns: {
          account_name: string | null;
          account_number: string;
          assigned_at: string | null;
          assignment_customer_email_source: string | null;
          bank_name: string | null;
          created_at: string;
          expires_at: string | null;
          order_id: string;
          provider: string | null;
        }[];
      };
      get_credit_direct_settings: {
        Args: { p_merchant_slug: string };
        Returns: {
          credit_direct_enabled: boolean;
          credit_direct_max_amount: number;
          credit_direct_min_amount: number;
          credit_direct_public_key: string;
          merchant_id: string;
          merchant_slug: string;
        }[];
      };
      get_customer_savings_feature_settings: {
        Args: { p_customer_id: string; p_merchant_id: string };
        Returns: {
          customer_device_savings_auto_debit_enabled: boolean;
          customer_device_savings_enabled: boolean;
          paystack_enabled: boolean;
        }[];
      };
      get_customer_wallet_dva_enabled: {
        Args: { p_customer_id: string; p_merchant_id: string };
        Returns: boolean;
      };
      get_domain_event_queue_metrics_v1: {
        Args: never;
        Returns: {
          measured_at: string;
          newest_message_age_seconds: number;
          oldest_message_age_seconds: number;
          queue_length: number;
          total_messages: number;
        }[];
      };
      get_effective_inventory_tracking_policy: {
        Args: { p_product_policy: string; p_variant_policy: string };
        Returns: string;
      };
      get_event_pipeline_operations_admin_v2: { Args: never; Returns: Json };
      get_event_pipeline_operations_admin_v3: { Args: never; Returns: Json };
      get_event_pipeline_operations_v1: { Args: never; Returns: Json };
      get_feed_product_variants: {
        Args: { p_merchant_id: string; p_product_ids: string[] };
        Returns: {
          attributes: Json;
          condition: string;
          id: string;
          price_override: number;
          product_id: string;
          sku: string;
          stock_quantity: number;
        }[];
      };
      get_fulfillment_items_array: {
        Args: { p_fulfillment: Json };
        Returns: Json;
      };
      get_merchant_analytics_config: {
        Args: { p_merchant_id: string };
        Returns: Json;
      };
      get_google_ads_connection_secret: {
        Args: { p_merchant_id: string };
        Returns: {
          access_token_ciphertext: string | null;
          id: string;
          provider_customer_id: string | null;
          refresh_token_ciphertext: string | null;
          status: string;
          token_expires_at: string | null;
        }[];
      };
      get_merchant_ads_connection_secret: {
        Args: { p_merchant_id: string; p_provider: string };
        Returns: {
          access_token_ciphertext: string | null;
          id: string;
          provider_customer_id: string | null;
          refresh_token_ciphertext: string | null;
          status: string;
          token_expires_at: string | null;
        }[];
      };
      consume_snapchat_ads_oauth_state_nonce: {
        Args: {
          p_merchant_id: string;
          p_nonce: string;
          p_redirect_uri: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      consume_merchant_ads_oauth_state_nonce: {
        Args: {
          p_merchant_id: string;
          p_nonce: string;
          p_provider: string;
          p_redirect_uri: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      reserve_merchant_ads_oauth_state_nonce: {
        Args: {
          p_expires_at: string;
          p_merchant_id: string;
          p_nonce: string;
          p_provider: string;
          p_redirect_uri: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      reserve_snapchat_ads_oauth_state_nonce: {
        Args: {
          p_expires_at: string;
          p_merchant_id: string;
          p_nonce: string;
          p_redirect_uri: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      get_merchant_balance: {
        Args: { currency_param: string; merchant_id_param: string };
        Returns: number;
      };
      get_merchant_id_for_user: {
        Args: { user_uuid: string };
        Returns: string;
      };
      get_merchant_identity_verified: {
        Args: { p_merchant_id: string };
        Returns: boolean;
      };
      get_merchant_inventory_stats: {
        Args: { p_merchant_id: string };
        Returns: Json;
      };
      get_merchant_payment_credential_ciphertext: {
        Args: {
          p_credential_role: string;
          p_environment: string;
          p_merchant_id: string;
          p_provider: string;
        };
        Returns: {
          ciphertext: string;
          kek_version: number;
        }[];
      };
      get_merchant_payment_credential_meta: {
        Args: { p_merchant_id: string; p_provider: string };
        Returns: {
          credential_role: string;
          disabled_at: string;
          environment: string;
          is_active: boolean;
          key_last4: string;
          last_validated_at: string;
          last_validation_error: string;
        }[];
      };
      get_merchant_paystack_subaccount_code: {
        Args: { p_merchant_id: string };
        Returns: string;
      };
      get_merchant_paystack_subaccount_configured: {
        Args: { p_merchant_id: string };
        Returns: boolean;
      };
      get_merchant_product_count: {
        Args: { merchant_id_param: string };
        Returns: number;
      };
      get_merchant_product_slug_resolution: {
        Args: { p_merchant_id: string; p_product_slug: string };
        Returns: {
          present: boolean;
          redirect_category: string;
          redirect_category_id: string;
          redirect_category_name: string;
          redirect_category_parent_id: string;
          redirect_category_slug: string;
          redirect_product_id: string;
          redirect_product_name: string;
          redirect_product_slug: string;
        }[];
      };
      get_merchant_product_slug_set: {
        Args: { p_merchant_id: string };
        Returns: string[];
      };
      get_merchant_push_tokens: {
        Args: { p_merchant_id: string };
        Returns: {
          device_name: string;
          platform: string;
          token: string;
        }[];
      };
      get_merchant_signup_policy_health: { Args: never; Returns: Json };
      get_merchant_signup_policy_health_pre_mobile_v2: {
        Args: never;
        Returns: Json;
      };
      get_merchant_verification_flags: {
        Args: { p_merchant_id: string };
        Returns: Json;
      };
      get_merchant_verification_status: {
        Args: { p_merchant_id: string };
        Returns: Json;
      };
      get_merchant_virtual_terminal_code: {
        Args: { p_merchant_id: string };
        Returns: string;
      };
      get_missing_index_suggestions: {
        Args: never;
        Returns: {
          columns: string;
          constraint_name: string;
          suggested_index: string;
          table_name: string;
        }[];
      };
      get_mobile_admin_dashboard_stats: {
        Args: {
          p_branch_id?: string;
          p_merchant_id: string;
          p_previous_end_at?: string;
          p_previous_start_at?: string;
          p_start_at?: string;
        };
        Returns: Json;
      };
      get_mobile_admin_order_counts: {
        Args: { p_branch_id?: string; p_merchant_id: string };
        Returns: Json;
      };
      get_mobile_admin_revenue_chart: {
        Args: { p_branch_id?: string; p_buckets: Json; p_merchant_id: string };
        Returns: Json;
      };
      get_monthly_sales_stats: {
        Args: { p_merchant_id: string };
        Returns: Json;
      };
      get_notification_stats: {
        Args: { p_notification_id: string };
        Returns: {
          read_rate: number;
          total_dismissed: number;
          total_read: number;
          total_sent: number;
        }[];
      };
      get_or_create_customer_wallet: {
        Args: { p_customer_id: string; p_merchant_id: string };
        Returns: string;
      };
      get_or_create_merchant_wallet: {
        Args: { p_merchant_id: string };
        Returns: string;
      };
      get_order_notification_outbox_manual_terminal_status: {
        Args: {
          p_event_type: string;
          p_merchant_id: string;
          p_order_id: string;
        };
        Returns: string;
      };
      get_order_payment_snapshot: {
        Args: { p_email: string; p_order_id: string };
        Returns: {
          currency: string;
          merchant_country: string;
          merchant_id: string;
          payment_status: string;
          shipping_status: string;
          total: number;
          tracking_token: string;
        }[];
      };
      get_order_receipt_bank_details: {
        Args: { p_order_id: string; p_tracking_token?: string };
        Returns: {
          bank_account_name: string;
          bank_account_number: string;
          bank_code: string;
          bank_name: string;
          brand_colors: Json;
          business_address: string;
          business_name: string;
          cac_rc_number: string;
          email: string;
          legal_entity_name: string;
          logo_url: string;
          pages: Json;
          phone: string;
          rider_phone_number: string;
          social_media: Json;
          support_email: string;
          support_phone: string;
          tax_identification_number: string;
          vat_rate: number;
          vat_registration_status: string;
        }[];
      };
      get_order_tracking: {
        Args: {
          p_email?: string;
          p_merchant_slug: string;
          p_order_id?: string;
          p_order_number?: string;
          p_tracking_token?: string;
        };
        Returns: {
          cancelled_at: string;
          created_at: string;
          currency: string;
          customer_email: string;
          customer_name: string;
          customer_phone: string;
          delivered_at: string;
          discount_amount: number;
          id: string;
          items: Json;
          merchant_business_name: string;
          merchant_id: string;
          merchant_logo_url: string;
          merchant_phone: string;
          merchant_slug: string;
          merchant_support_email: string;
          merchant_support_phone: string;
          order_number: string;
          paid_at: string;
          payment_status: string;
          shipped_at: string;
          shipping_address: Json;
          shipping_cost: number;
          shipping_provider: string;
          shipping_status: string;
          subtotal: number;
          total: number;
          tracking_number: string;
          updated_at: string;
        }[];
      };
      get_order_variant_overrides: {
        Args: { p_variant_ids: string[] };
        Returns: {
          id: string;
          price_override: number;
          product_id: string;
        }[];
      };
      get_pending_provider_shipment_cancellation_finalization: {
        Args: { p_merchant_id: string; p_shipment_id: string };
        Returns: Json;
      };
      get_platform_analytics_summary: {
        Args: { p_end_date: string; p_start_date: string };
        Returns: Json;
      };
      get_platform_admin_context_v1: {
        Args: never;
        Returns: { permissions: string[]; role: string }[];
      };
      get_product_offers: {
        Args: { p_product_id: string };
        Returns: {
          compare_at_price: number;
          condition: string;
          condition_notes: string;
          grade: string;
          images: Json;
          offer_id: string;
          price: number;
          stock_quantity: number;
        }[];
      };
      get_product_rating_stats: {
        Args: { p_product_id: string };
        Returns: {
          average_rating: number;
          rating_distribution: Json;
          review_count: number;
        }[];
      };
      get_public_blog_categories: {
        Args: { p_merchant_id: string };
        Returns: {
          category: string;
        }[];
      };
      get_public_platform_analytics_config_v1: {
        Args: never;
        Returns: {
          facebook_pixel_id: string | null;
          google_analytics_id: string | null;
          snapchat_pixel_id: string | null;
          tiktok_pixel_id: string | null;
          twitter_pixel_id: string | null;
        }[];
      };
      get_public_serialized_variant_availability_counts: {
        Args: {
          p_branch_id?: string;
          p_merchant_id: string;
          p_product_ids: string[];
        };
        Returns: {
          product_id: string;
          public_available_units: number;
          variant_id: string;
        }[];
      };
      get_push_token_stats: {
        Args: never;
        Returns: {
          active_count: number;
          app_type: string;
          platform: string;
          total_count: number;
        }[];
      };
      get_quiz_attempt_result_v2: {
        Args: { p_attempt_id: string };
        Returns: Json;
      };
      get_quiz_event_question_counts: {
        Args: { p_event_ids: string[] };
        Returns: {
          event_id: string;
          question_count: number;
        }[];
      };
      get_quiz_leaderboard: {
        Args: { p_event_id: string };
        Returns: {
          attempt_id: string;
          customer_id: string;
          customer_name: string;
          is_current_customer: boolean;
          rank: number;
          score: number;
          status: string;
          submitted_at: string;
          total_time_seconds: number;
        }[];
      };
      get_quiz_leaderboard_public: {
        Args: { p_event_id: string };
        Returns: {
          customer_name: string;
          is_current_customer: boolean;
          rank: number;
          score: number;
          status: string;
          submitted_at: string;
          total_time_seconds: number;
        }[];
      };
      get_quiz_leaderboard_public_v2: {
        Args: { p_event_id: string };
        Returns: Json;
      };
      get_receipt_claim_campaign_stats: {
        Args: { p_import_job_id: string; p_merchant_id: string };
        Returns: Json;
      };
      get_record_payment_order_transactions: {
        Args: { p_merchant_id: string; p_order_id: string };
        Returns: {
          amount: number;
          error_code: string;
          gateway: string;
          gateway_reference: string;
          status: string;
        }[];
      };
      get_repair_pickup_receiver: {
        Args: { p_merchant_id: string };
        Returns: Json;
      };
      get_repair_status: {
        Args: {
          p_email: string;
          p_merchant_id: string;
          p_ticket_number: number;
        };
        Returns: {
          created_at: string;
          device_model: string;
          device_type: string;
          pickup_currency: string | null;
          pickup_fee: number | null;
          pickup_payment_status: string | null;
          repair_type_label: string;
          service_type: string;
          status: Database['public']['Enums']['repair_status'];
          ticket_number: number;
          tracking_number: string;
          updated_at: string;
        }[];
      };
      get_sales_by_channel: {
        Args: {
          p_end_date: string;
          p_merchant_id: string;
          p_start_date: string;
        };
        Returns: Json;
      };
      get_sales_by_payment_method: {
        Args: {
          p_end_date: string;
          p_merchant_id: string;
          p_start_date: string;
        };
        Returns: Json;
      };
      get_sales_dashboard_stats: {
        Args: { p_merchant_id: string };
        Returns: Json;
      };
      get_social_proof_stats: {
        Args: { p_merchant_id: string; p_product_id: string };
        Returns: Json;
      };
      get_staff_invite_preview: {
        Args: { p_token: string };
        Returns: {
          email: string;
          invitation_expires_at: string;
          merchant_business_name: string;
          merchant_slug: string;
          role: Database['public']['Enums']['staff_role'];
          status: string;
        }[];
      };
      get_staff_permissions: { Args: { p_staff_id: string }; Returns: Json };
      get_storefront_blog_listing_status: {
        Args: { p_author_name: string; p_identifier: string };
        Returns: {
          author_count: number;
          blog_enabled: boolean;
          categories: string[];
          category_counts: number[];
          storefront_status: string;
          total_count: number;
        }[];
      };
      get_storefront_blog_post_status: {
        Args: { p_identifier: string; p_post_slug: string };
        Returns: {
          blog_enabled: boolean;
          live_present: boolean;
          redirect_target_slug: string;
          storefront_status: string;
        }[];
      };
      get_storefront_category_slug_state: {
        Args: { p_merchant_id: string; p_slug: string };
        Returns: {
          is_active: boolean;
        }[];
      };
      get_storefront_cluster_guide_candidates_v1: {
        Args: {
          p_category_slug: string;
          p_cluster_rules: Json;
          p_limit?: number;
          p_merchant_id: string;
          p_search_query: string;
        };
        Returns: {
          category: string;
          excerpt: string;
          featured_image_url: string;
          keywords: string[];
          published_at: string;
          reading_time_minutes: number;
          slug: string;
          tags: string[];
          title: string;
        }[];
      };
      get_storefront_discount_code: {
        Args: {
          p_code: string;
          p_include_inactive?: boolean;
          p_merchant_id: string;
        };
        Returns: {
          applies_to: string;
          category_ids: Json;
          code: string;
          description: string;
          discount_type: string;
          discount_value: number;
          expires_at: string;
          id: string;
          is_active: boolean;
          maximum_discount_amount: number;
          minimum_purchase_amount: number;
          product_ids: Json;
          starts_at: string;
          usage_count: number;
          usage_limit: number;
          usage_limit_per_customer: number;
        }[];
      };
      get_storefront_order_quote_validation_context: {
        Args: {
          p_customer_email: string;
          p_has_selected_quote_id?: boolean;
          p_merchant_id: string;
          p_order_id: string;
          p_selected_quote_id?: string;
          p_tracking_token: string;
        };
        Returns: {
          order_items: Json;
          selected_quote_id: string;
          shipping_address: Json;
          shipping_fee: number;
          shipping_provider: string;
        }[];
      };
      get_storefront_payment_settings: {
        Args: { p_merchant_id: string };
        Returns: {
          credit_direct_enabled: boolean;
          credpal_enabled: boolean;
          juicyway_enabled: boolean;
          klump_enabled: boolean;
          klump_max_amount: number;
          klump_min_amount: number;
          korapay_enabled: boolean;
          pay_on_delivery_enabled: boolean;
          paystack_enabled: boolean;
          vat_rate: number;
          vat_registration_status: string;
          wallet_order_auto_debit_enabled: boolean;
          wallet_paystack_dva_enabled: boolean;
        }[];
      };
      get_storefront_pdp_core_v2: {
        Args: {
          p_branch_id?: string;
          p_merchant_id: string;
          p_product_slug: string;
        };
        Returns: {
          product_data: Json;
          resolution_status: string;
        }[];
      };
      get_storefront_pdp_preflight: {
        Args: { p_identifier: string; p_product_slug: string };
        Returns: {
          catalog_nonempty: boolean;
          category_id: string;
          category_name: string;
          category_slug: string;
          match_kind: string;
          present: boolean;
          product_category: string;
          product_id: string;
          product_name: string;
          product_slug: string;
          storefront_status: string;
        }[];
      };
      get_storefront_pdp_semantic_enrichment_v1: {
        Args: {
          p_category_slug: string;
          p_cluster_guide_limit?: number;
          p_cluster_rules: Json;
          p_include_guides?: boolean;
          p_inventory_limit?: number;
          p_merchant_id: string;
          p_product_guide_limit?: number;
          p_product_id: string;
          p_search_query: string;
        };
        Returns: {
          cluster_guide_data: Json;
          inventory_data: Json;
          product_guide_data: Json;
          resolution_status: string;
        };
      };
      get_storefront_product_variants: {
        Args: { p_product_ids: string[] };
        Returns: {
          attributes: Json;
          condition: string;
          created_at: string;
          id: string;
          images: Json;
          price_override: number;
          primary_image: string;
          product_id: string;
          sku: string;
          stock_quantity: number;
          updated_at: string;
        }[];
      };
      get_storefront_receipt_merchant_info: {
        Args: { p_slug: string };
        Returns: {
          bank_account_name: string;
          bank_account_number: string;
          bank_code: string;
          bank_name: string;
          brand_colors: Json;
          business_address: string;
          business_name: string;
          cac_rc_number: string;
          email: string;
          legal_entity_name: string;
          logo_url: string;
          pages: Json;
          phone: string;
          rider_phone_number: string;
          social_media: Json;
          support_email: string;
          support_phone: string;
          tax_identification_number: string;
          vat_rate: number;
          vat_registration_status: string;
        }[];
      };
      get_storefront_shipping_rates: {
        Args: { p_merchant_id: string };
        Returns: Json;
      };
      get_storefront_vtu_settings: {
        Args: { p_merchant_id: string };
        Returns: {
          vtu_airtime_enabled: boolean;
          vtu_betting_enabled: boolean;
          vtu_data_enabled: boolean;
          vtu_electricity_enabled: boolean;
          vtu_enabled: boolean;
          vtu_tv_enabled: boolean;
        }[];
      };
      get_supplier_purchase_analytics: {
        Args: {
          p_branch_id?: string;
          p_end_date?: string;
          p_merchant_id: string;
          p_start_date?: string;
        };
        Returns: {
          gross_profit: number;
          loss_unit_count: number;
          missing_cost_unit_count: number;
          order_count: number;
          supplier_name: string;
          total_cost: number;
          total_revenue: number;
          unit_count: number;
        }[];
      };
      get_top_products: {
        Args: {
          p_branch_id?: string;
          p_end_date: string;
          p_limit?: number;
          p_merchant_id: string;
          p_start_date: string;
        };
        Returns: Json;
      };
      get_total_sales: { Args: never; Returns: number };
      get_unread_notification_count: {
        Args: { p_merchant_id: string };
        Returns: number;
      };
      get_user_access: {
        Args: never;
        Returns: {
          is_owner: boolean;
          is_staff: boolean;
          merchant_id: string;
          permissions: Json;
          role: string;
        }[];
      };
      get_user_merchant_access: {
        Args: { p_user_id: string };
        Returns: {
          is_owner: boolean;
          merchant_id: string;
          merchant_name: string;
          permissions: Json;
          role: Database['public']['Enums']['staff_role'];
        }[];
      };
      get_user_merchant_context: { Args: never; Returns: Json };
      get_wallet_summary: {
        Args: { p_merchant_id: string };
        Returns: {
          available_balance: number;
          can_withdraw: boolean;
          next_settlement_amount: number;
          next_settlement_date: string;
          pending_balance: number;
          total_earned: number;
          total_withdrawn: number;
          upcoming_balance: number;
          upcoming_count: number;
          wallet_id: string;
          auto_payout_enabled: boolean;
          auto_payout_day: string;
          min_payout_amount: number;
          last_payout_at: string | null;
          last_payout_amount: number | null;
        }[];
      };
      get_website_performance_event_summary: {
        Args: {
          p_end_date: string;
          p_merchant_id: string;
          p_start_date: string;
        };
        Returns: Json;
      };
      has_cache_invalidation_dead_letters: { Args: never; Returns: boolean };
      has_storefront_order_idempotency_key: {
        Args: { p_checkout_idempotency_key: string; p_merchant_id: string };
        Returns: boolean;
      };
      is_legacy_storefront_order_idempotency_key: {
        Args: { p_checkout_idempotency_key: string; p_merchant_id: string };
        Returns: boolean;
      };
      has_merchant_access: {
        Args: { p_merchant_id: string };
        Returns: boolean;
      };
      immutable_unaccent: { Args: { search_text: string }; Returns: string };
      increment_blog_post_views: {
        Args: { p_post_id: string };
        Returns: undefined;
      };
      increment_hero_image_usage: {
        Args: { image_id: string };
        Returns: undefined;
      };
      invoke_cleanup_pending_transactions: { Args: never; Returns: undefined };
      is_active_staff_of: {
        Args: { p_merchant_id: string; p_user_id: string };
        Returns: boolean;
      };
      is_agentic_checkout_context: { Args: never; Returns: boolean };
      is_customer_username_available: {
        Args: { p_merchant_id: string; p_username: string };
        Returns: boolean;
      };
      is_event_ingress_capability_v1: {
        Args: {
          p_event_id: string;
          p_event_name: string;
          p_event_timestamp: string;
          p_event_type: string;
          p_kind: string;
          p_merchant_id: string;
          p_producer: string;
          p_source: string;
          p_trust_level: string;
        };
        Returns: boolean;
      };
      is_merchant_sales_transaction: {
        Args: { p_metadata: Json };
        Returns: boolean;
      };
      is_reserved_merchant_slug: { Args: { p_slug: string }; Returns: boolean };
      is_sent_admin_notification_v1: {
        Args: { p_notification_id: string };
        Returns: boolean;
      };
      is_staff_of_merchant: {
        Args: { p_merchant_id: string };
        Returns: boolean;
      };
      is_usable_repair_pickup_phone: {
        Args: { p_phone: string };
        Returns: boolean;
      };
      is_valid_email: { Args: { email_text: string }; Returns: boolean };
      is_valid_username_format: {
        Args: { p_username: string };
        Returns: boolean;
      };
      issue_credit_direct_checkout_token: {
        Args: {
          p_email: string;
          p_merchant_id: string;
          p_order_id: string;
          p_session_id: string;
          p_tracking_token: string;
        };
        Returns: {
          checkout_token: string;
          expires_at: string;
          signed_amount: number;
        }[];
      };
      link_transaction_order_item_product: {
        Args: {
          p_merchant_id: string;
          p_order_item_id: string;
          p_product_id: string;
          p_variant_id: string;
        };
        Returns: undefined;
      };
      list_event_pipeline_deliveries_v1: {
        Args: {
          p_destination?: string;
          p_error_code?: string;
          p_from?: string;
          p_limit?: number;
          p_merchant_id?: string;
          p_offset?: number;
          p_status: string;
          p_to?: string;
        };
        Returns: Json;
      };
      list_event_pipeline_deliveries_admin_v2: {
        Args: {
          p_destination?: string;
          p_error_code?: string;
          p_from?: string;
          p_limit?: number;
          p_merchant_id?: string;
          p_offset?: number;
          p_status: string;
          p_to?: string;
        };
        Returns: Json;
      };
      list_event_pipeline_deliveries_admin_v3: {
        Args: {
          p_destination?: string;
          p_error_code?: string;
          p_from?: string;
          p_limit?: number;
          p_merchant_id?: string;
          p_offset?: number;
          p_status: string;
          p_to?: string;
        };
        Returns: Json;
      };
      list_event_pipeline_ingress_failures_v1: {
        Args: {
          p_error_code?: string;
          p_from?: string;
          p_limit?: number;
          p_merchant_id?: string;
          p_offset?: number;
          p_to?: string;
        };
        Returns: Json;
      };
      list_event_pipeline_ingress_failures_admin_v2: {
        Args: {
          p_error_code?: string;
          p_from?: string;
          p_limit?: number;
          p_merchant_id?: string;
          p_offset?: number;
          p_to?: string;
        };
        Returns: Json;
      };
      list_event_pipeline_ingress_failures_admin_v3: {
        Args: {
          p_error_code?: string;
          p_from?: string;
          p_limit?: number;
          p_merchant_id?: string;
          p_offset?: number;
          p_to?: string;
        };
        Returns: Json;
      };
      list_platform_admin_memberships_v1: {
        Args: { p_limit?: number; p_offset?: number };
        Returns: {
          created_at: string | null;
          email: string;
          granted_at: string | null;
          is_legacy_owner: boolean;
          is_revocable: boolean;
          reason: string;
          revoked_at: string | null;
          role: string;
          status: string;
          updated_at: string | null;
        }[];
      };
      list_platform_audit_events_v1: {
        Args: {
          p_action?: string;
          p_before_event_id?: string;
          p_before_event_source?: string;
          p_before_occurred_at?: string;
          p_limit?: number;
          p_resource_type?: string;
          p_source?: string;
        };
        Returns: {
          action: string;
          actor_kind: string;
          changed_fields: string[];
          event_id: string;
          event_source: string;
          occurred_at: string;
          resource_type: string;
        }[];
      };
      list_merchant_audit_events_v1: {
        Args: {
          p_action?: string;
          p_before_id?: string;
          p_before_occurred_at?: string;
          p_limit: number;
          p_merchant_id: string;
          p_resource_type?: string;
        };
        Returns: {
          action: string;
          actor_label: string;
          actor_type: string;
          actor_user_id: string;
          after_values: Json;
          before_values: Json;
          changed_fields: string[];
          correlation_id: string;
          database_transaction_id: string;
          id: string;
          merchant_id: string;
          merchant_label: string;
          metadata: Json;
          occurred_at: string;
          request_id: string;
          resource_id: string;
          resource_type: string;
          schema_version: number;
          source: string;
        }[];
      };
      list_quiz_events_v2: {
        Args: { p_limit?: number; p_merchant_id: string; p_offset?: number };
        Returns: Json;
      };
      launch_quiz_event_v2: {
        Args: {
          p_ends_at: string;
          p_event_id: string;
          p_question_count: number;
          p_regulatory_basis: string;
          p_regulatory_evidence_ref: string;
          p_regulatory_jurisdiction: string;
          p_rules_version: string;
          p_starts_at: string;
          p_time_per_question_seconds: number;
          p_time_zone: string;
        };
        Returns: Json;
      };
      list_variant_inventory_units: {
        Args: {
          p_branch_id?: string;
          p_branch_scope?: string;
          p_cursor_created_at?: string;
          p_cursor_id?: string;
          p_limit?: number;
          p_merchant_id: string;
          p_product_id: string;
          p_status?: string;
          p_variant_id?: string;
        };
        Returns: Json;
      };
      mark_abandoned_orders: {
        Args: { hours_threshold?: number };
        Returns: undefined;
      };
      mark_all_visible_merchant_notifications_read_v1: {
        Args: { p_merchant_id: string };
        Returns: {
          remaining_unread_count: number;
          updated_count: number;
        }[];
      };
      mark_customer_savings_redemptions_reversed: {
        Args: { p_merchant_id: string; p_order_id: string; p_reason: string };
        Returns: number;
      };
      mark_merchant_payment_credential_invalid: {
        Args: {
          p_credential_role: string;
          p_environment: string;
          p_error: string;
          p_merchant_id: string;
          p_provider: string;
        };
        Returns: undefined;
      };
      mark_order_inventory_units_sold: {
        Args: { p_merchant_id: string; p_order_id: string };
        Returns: Json;
      };
      mark_order_payment_failed_and_release_inventory: {
        Args: {
          p_merchant_id: string;
          p_notes?: string;
          p_order_id: string;
          p_payment_status: string;
          p_shipping_address?: Json;
        };
        Returns: Json;
      };
      mark_paypal_transaction_refunded: {
        Args: {
          p_pending_refund_ids?: string[];
          p_restore_prepaid_on_reconcile?: boolean;
          p_status: string;
          p_transaction_id: string;
        };
        Returns: boolean;
      };
      mark_petrock_imei_submission_unknown: {
        Args: {
          p_lease_token?: string;
          p_lookup_id: string;
          p_order_id?: string;
          p_provider_status: string;
        };
        Returns: boolean;
      };
      mark_petrock_remediation_submission_unknown: {
        Args: {
          p_order_id: string;
          p_provider_order_id?: string;
          p_reason: string;
        };
        Returns: boolean;
      };
      mark_repair_pickup_awaiting_payment: {
        Args: { p_merchant_id: string; p_repair_id: string };
        Returns: {
          marked: boolean;
        }[];
      };
      mark_transaction_order_item_custom: {
        Args: { p_merchant_id: string; p_order_item_id: string };
        Returns: undefined;
      };
      mark_wallet_funding_intents_review_required: {
        Args: {
          p_gateway_reference: string;
          p_intent_ids: string[];
          p_reason: string;
        };
        Returns: undefined;
      };
      match_blog_to_product: {
        Args: {
          match_count?: number;
          match_threshold?: number;
          merchant_id_filter: string;
          product_embedding: string;
        };
        Returns: {
          category: string;
          excerpt: string;
          featured_image_url: string;
          id: string;
          reading_time_minutes: number;
          similarity: number;
          slug: string;
          title: string;
        }[];
      };
      merchant_feature_settings_public_cache_projection: {
        Args: {
          p_settings: Database['public']['Tables']['merchant_feature_settings']['Row'];
        };
        Returns: Json;
      };
      mint_quiz_event_ranked_awards: {
        Args: { p_event_id: string };
        Returns: number;
      };
      mutate_merchant_blog_post_with_product_links: {
        Args: {
          p_merchant_id: string;
          p_post_data: Json;
          p_post_id: string;
          p_product_ids?: string[];
        };
        Returns: {
          category: string;
          content: string;
          excerpt: string;
          featured_image_url: string;
          id: string;
          merchant_id: string;
          published_at: string;
          slug: string;
          status: string;
          title: string;
        }[];
      };
      mutate_merchant_blog_post_with_product_links_base: {
        Args: {
          p_merchant_id: string;
          p_post_data: Json;
          p_post_id: string;
          p_product_ids?: string[];
        };
        Returns: {
          category: string;
          content: string;
          excerpt: string;
          featured_image_url: string;
          id: string;
          merchant_id: string;
          published_at: string;
          slug: string;
          status: string;
          title: string;
        }[];
      };
      normalize_inventory_identifier: {
        Args: { p_value: string };
        Returns: string;
      };
      normalize_product_search_text: {
        Args: { search_text: string };
        Returns: string;
      };
      normalize_repair_pickup_phone_digits: {
        Args: { p_phone: string };
        Returns: string;
      };
      normalize_variant_axis_value: {
        Args: { p_value: string };
        Returns: string;
      };
      pause_customer_savings_goal: {
        Args: {
          p_actor_id?: string;
          p_customer_id: string;
          p_goal_id: string;
          p_merchant_id: string;
        };
        Returns: {
          goal_status: string;
          success: boolean;
        }[];
      };
      pause_gigl_tracking_monitor: {
        Args: {
          p_error: string;
          p_shipment_id: string;
          p_tracking_epoch_id: string;
          p_worker_id: string;
        };
        Returns: boolean;
      };
      petrock_model_scope_matches: {
        Args: { p_device_model: string; p_model_scope: Json };
        Returns: boolean;
      };
      prepare_order_notification_outbox_manual_send: {
        Args: {
          p_courier_name?: string;
          p_estimated_delivery?: string;
          p_event_type: string;
          p_merchant_id: string;
          p_order_id: string;
          p_tracking_number?: string;
        };
        Returns: Json;
      };
      prepare_petrock_remediation_order: {
        Args: {
          p_customer_id: string;
          p_fx_rate: number;
          p_merchant_id: string;
          p_order_id: string;
          p_payment_currency: string;
          p_product_id: string;
        };
        Returns: {
          amount_ngn: number | null;
          amount_usdt: number | null;
          carrier: string | null;
          completed_at: string | null;
          cost_usd: number | null;
          created_at: string;
          customer_id: string;
          customer_message: string | null;
          device_model: string | null;
          eligibility_checks_completed: string[];
          eligibility_evidence: Json;
          eligibility_next_check: string | null;
          email_notification_claim_token: string | null;
          email_notification_claim_until: string | null;
          email_notified_at: string | null;
          failure_reason: string | null;
          feedback_token_hash: string | null;
          fx_rate_used: number | null;
          id: string;
          identifier_ciphertext: string | null;
          identifier_hash: string;
          in_app_notified_at: string | null;
          merchant_id: string;
          next_poll_at: string | null;
          paid_at: string | null;
          payment_currency: string | null;
          provider_attempt_started_at: string | null;
          provider_order_id: string | null;
          provider_reference_id: string | null;
          provider_status: string | null;
          push_notification_claim_token: string | null;
          push_notification_claim_until: string | null;
          push_notified_at: string | null;
          reconcile_attempts: number;
          reconcile_lease_token: string | null;
          reconcile_lease_until: string | null;
          refund_policy: string | null;
          refunded_at: string | null;
          remediation_product_id: string | null;
          source_lookup_id: string;
          status: string;
          status_segment: string | null;
          submitted_at: string | null;
          success_rate: number | null;
          turnaround: string | null;
          updated_at: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'petrock_orders';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      prepare_storefront_order_for_checkout: {
        Args: {
          p_customer_email: string;
          p_has_selected_quote_id?: boolean;
          p_merchant_id: string;
          p_order_id: string;
          p_payment_method: string;
          p_selected_quote_id?: string;
          p_shipping_address?: Json;
          p_shipping_provider?: string;
          p_tracking_token: string;
        };
        Returns: {
          currency: string;
          id: string;
          order_number: string;
          payment_method: string;
          payment_status: string;
          shipping_fee: number;
          shipping_status: string;
          subtotal: number;
          total: number;
          tracking_token: string;
        }[];
      };
      preview_receipt_claim: { Args: { p_token_hash: string }; Returns: Json };
      process_due_settlements: {
        Args: never;
        Returns: {
          details: Json;
          processed_count: number;
          total_amount: number;
        }[];
      };
      process_due_quiz_deadlines_v2: {
        Args: {
          p_production_approved: boolean;
          p_production_phase: boolean;
        };
        Returns: Json;
      };
      set_quiz_runtime_control_v2: {
        Args: {
          p_production_approved: boolean;
          p_production_phase: boolean;
        };
        Returns: Json;
      };
      product_autocomplete:
        | {
            Args: {
              merchant_id_param: string;
              result_limit?: number;
              search_prefix: string;
            };
            Returns: {
              category: string;
              id: string;
              image_small: string;
              name: string;
              price: number;
            }[];
          }
        | {
            Args: {
              merchant_id_param: string;
              result_limit?: number;
              search_prefix: string;
            };
            Returns: {
              category: string;
              id: string;
              image_small: string;
              name: string;
              price: number;
            }[];
          };
      product_autocomplete_v2: {
        Args: {
          merchant_id_param: string;
          result_limit?: number;
          search_prefix: string;
        };
        Returns: {
          category: string;
          id: string;
          image_small: string;
          name: string;
          price: number;
          relevance: number;
          slug: string;
        }[];
      };
      product_search_vector_v2: {
        Args: {
          product_brand: string;
          product_category: string;
          product_description: string;
          product_name: string;
          product_sku: string;
        };
        Returns: unknown;
      };
      promote_due_scheduled_quiz_events: {
        Args: { p_event_id?: string; p_merchant_id?: string };
        Returns: number;
      };
      promote_due_scheduled_quiz_events_service_v2: {
        Args: never;
        Returns: number;
      };
      provision_mobile_merchant_v2: {
        Args: {
          p_brand_colors: Json;
          p_business_name: string;
          p_business_type: string;
          p_country: string;
          p_first_name: string;
          p_last_name: string;
          p_logo_url: string;
          p_other_business_type: string;
          p_phone: string;
          p_signup_source: string;
          p_slug: string;
          p_slug_is_custom: boolean;
        };
        Returns: {
          created: boolean;
          merchant_id: string;
          merchant_slug: string;
        }[];
      };
      queue_expense_private_receipt_cleanup: {
        Args: {
          p_expense_id: string;
          p_merchant_id: string;
          p_storage_path: string;
        };
        Returns: boolean;
      };
      queue_unreferenced_expense_private_receipt_cleanup: {
        Args: { p_merchant_id: string; p_storage_path: string };
        Returns: boolean;
      };
      quiz_answer_key_hash: { Args: { p_answer: string }; Returns: string };
      quiz_answer_key_matches: {
        Args: { p_answer: string; p_answer_key_hash: string };
        Returns: boolean;
      };
      quiz_bind_attempt_device_internal: {
        Args: {
          p_attempt_id: string;
          p_device_hash: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      quiz_compare_signatures: {
        Args: { p_left: string; p_right: string };
        Returns: boolean;
      };
      quiz_device_cap_ready: { Args: never; Returns: boolean };
      quiz_device_proof_subject: {
        Args: { p_device_hash: string; p_scope_id: string };
        Returns: string;
      };
      quiz_effective_question_deadline_v2: {
        Args: {
          p_event_ends_at: string;
          p_issued_at: string;
          p_time_limit_seconds: number;
        };
        Returns: string;
      };
      quiz_event_max_attempts: {
        Args: { p_event_id: string };
        Returns: number;
      };
      quiz_free_entry_ready: { Args: never; Returns: boolean };
      quiz_log_route_proof_failure: {
        Args: { p_reason: string; p_route_proof: Json };
        Returns: boolean;
      };
      quiz_normalize_answer_key: {
        Args: { p_answer: string };
        Returns: string;
      };
      quiz_normalize_email: { Args: { p_email: string }; Returns: string };
      quiz_route_proof_valid:
        | { Args: { p_route_proof: Json }; Returns: boolean }
        | {
            Args: {
              p_expected_action?: string;
              p_expected_subject_id?: string;
              p_expected_user_id?: string;
              p_route_proof: Json;
            };
            Returns: boolean;
          };
      quiz_rpc_server_secret_configured: { Args: never; Returns: boolean };
      quiz_runtime_contract_version: { Args: never; Returns: number };
      read_domain_events_v1: {
        Args: {
          p_batch_size?: number;
          p_max_poll_seconds?: number;
          p_visibility_timeout_seconds?: number;
        };
        Returns: {
          enqueued_at: string;
          message: Json;
          msg_id: number;
          read_ct: number;
          visible_at: string;
        }[];
      };
      rebuild_sku_matrix_product_projection: {
        Args: { p_product_id: string };
        Returns: undefined;
      };
      rebuild_sku_matrix_products: {
        Args: { p_product_ids: string[] };
        Returns: undefined;
      };
      record_analytics_domain_event_v1: {
        Args: {
          p_delivery_data: Json;
          p_domain_event_data: Json;
          p_event_data: Json;
          p_event_name: string;
          p_event_timestamp: string;
          p_event_type: string;
          p_external_event_id: string;
          p_merchant_id: string;
          p_metadata?: Json;
          p_producer: string;
          p_source: string;
          p_trust_level: string;
        };
        Returns: {
          already_enqueued: boolean;
          domain_event_id: string;
          queue_message_id: number;
        }[];
      };
      record_bvn_verification: {
        Args: {
          p_bvn: string;
          p_date_of_birth: string;
          p_first_name: string;
          p_last_name: string;
          p_merchant_id: string;
        };
        Returns: undefined;
      };
      record_cac_verification: {
        Args: {
          p_cac_approved_name: string;
          p_cac_certificate_path: string;
          p_merchant_id: string;
          p_rc_number: string;
        };
        Returns: undefined;
      };
      record_credit_direct_client_completion: {
        Args: {
          p_checkout_transaction_id?: string;
          p_email?: string;
          p_order_id: string;
          p_session_id?: string;
          p_tracking_token?: string;
        };
        Returns: Json;
      };
      record_credit_direct_client_completion_v1: {
        Args: {
          p_checkout_transaction_id?: string;
          p_order_id: string;
          p_session_id?: string;
          p_tracking_token?: string;
        };
        Returns: Json;
      };
      record_event_worker_heartbeat_v1: {
        Args: {
          p_error_code?: string;
          p_processed_count?: number;
          p_status: string;
          p_worker_id: string;
          p_worker_name: string;
        };
        Returns: undefined;
      };
      record_external_order_inventory_units: {
        Args: {
          p_merchant_id: string;
          p_order_id: string;
          p_order_item_id: string;
          p_source?: string;
          p_units: Json;
        };
        Returns: Json;
      };
      record_gigl_tracking_failure: {
        Args: {
          p_error: string;
          p_shipment_id: string;
          p_tracking_epoch_id: string;
          p_worker_id: string;
        };
        Returns: boolean;
      };
      record_juicyway_usdt_deposit_address: {
        Args: {
          p_address: Json;
          p_provider_status: string;
          p_session_id: string;
          p_transaction_id: string;
        };
        Returns: boolean;
      };
      record_klump_transaction_id: {
        Args: {
          p_klump_transaction_id: string;
          p_merchant_reference: string;
          p_tracking_token: string;
        };
        Returns: {
          code: string;
          transaction_id: string;
        }[];
      };
      record_manual_order_payment: {
        Args: {
          p_amount: number;
          p_currency: string;
          p_description: string;
          p_gateway_reference: string;
          p_idempotency_key: string;
          p_merchant_id: string;
          p_metadata: Json;
          p_order_id: string;
        };
        Returns: Json;
      };
      record_merchant_quiz_answer_key_review: {
        Args: { p_event_id: string; p_merchant_id: string; p_reviewed: Json };
        Returns: boolean;
      };
      record_merchant_settlement: {
        Args: {
          p_description: string;
          p_gateway: string;
          p_gateway_fee: number;
          p_gateway_reference: string;
          p_gross_amount: number;
          p_merchant_id: string;
          p_metadata: Json;
          p_platform_fee: number;
          p_source_id: string;
          p_source_type: string;
        };
        Returns: string;
      };
      record_merchant_settlement_v2: {
        Args: {
          p_description: string;
          p_gateway: string;
          p_gateway_fee: number;
          p_gateway_reference: string;
          p_gross_amount: number;
          p_merchant_id: string;
          p_metadata: Json;
          p_platform_fee: number;
          p_settlement_type?: string;
          p_source_id: string;
          p_source_type: string;
        };
        Returns: string;
      };
      record_nin_verification: {
        Args: {
          p_date_of_birth: string;
          p_first_name: string;
          p_last_name: string;
          p_merchant_id: string;
          p_nin: string;
        };
        Returns: undefined;
      };
      record_petrock_imei_submission: {
        Args: {
          p_lease_token?: string;
          p_lookup_id: string;
          p_next_poll_at: string;
          p_order_id: string;
          p_provider_status: string;
        };
        Returns: boolean;
      };
      record_petrock_remediation_submission: {
        Args: {
          p_next_poll_at: string;
          p_order_id: string;
          p_provider_order_id: string;
          p_provider_status: string;
        };
        Returns: boolean;
      };
      record_platform_domain_event_v1: {
        Args: {
          p_delivery_data: Json;
          p_event_data: Json;
          p_event_name: string;
          p_event_timestamp: string;
          p_event_type: string;
          p_external_event_id: string;
          p_merchant_id: string;
          p_metadata?: Json;
          p_page_url: string;
          p_producer: string;
          p_referrer: string;
          p_session_id: string;
          p_trust_level: string;
        };
        Returns: {
          already_enqueued: boolean;
          domain_event_id: string;
          queue_message_id: number;
        }[];
      };
      record_quiz_answer: {
        Args: {
          p_answer_payload: Json;
          p_attempt_id: string;
          p_question_slot_id: string;
          p_route_proof?: Json;
          p_trusted?: boolean;
          p_user_id?: string;
        };
        Returns: string;
      };
      record_receipt_claim_app_download_clicked_v2: {
        Args: { p_source: string; p_token_hash: string };
        Returns: undefined;
      };
      record_receipt_claim_click: {
        Args: { p_token_hash: string };
        Returns: undefined;
      };
      record_receipt_claim_click_v2: {
        Args: { p_source: string; p_token_hash: string };
        Returns: undefined;
      };
      record_receipt_claim_login_started: {
        Args: { p_token_hash: string };
        Returns: undefined;
      };
      record_receipt_claim_login_started_v2: {
        Args: { p_source: string; p_token_hash: string };
        Returns: undefined;
      };
      record_repair_pickup_payment_mismatch: {
        Args: {
          p_amount: number;
          p_currency: string;
          p_gateway_response: Json;
          p_merchant_id: string;
          p_mismatch_reason: string;
          p_reference: string;
          p_repair_id: string;
        };
        Returns: {
          recorded: boolean;
        }[];
      };
      record_shipment_inventory_reconciliation: {
        Args: {
          p_error_code: string;
          p_error_context?: Json;
          p_merchant_id: string;
          p_order_id: string;
          p_provider: string;
          p_shipment_id: string;
          p_tracking_number: string;
        };
        Returns: string;
      };
      record_wallet_order_funding_event: {
        Args: {
          p_event_type: string;
          p_gateway_reference?: string;
          p_intent_id?: string;
          p_metadata?: Json;
          p_order_id?: string;
          p_transaction_id?: string;
        };
        Returns: undefined;
      };
      redeem_customer_wallet: {
        Args: {
          p_amount: number;
          p_customer_id: string;
          p_description?: string;
          p_merchant_id: string;
          p_source_id: string;
          p_source_type: string;
        };
        Returns: {
          new_balance: number;
          success: boolean;
          transaction_id: string;
        }[];
      };
      redeem_imei_wallet_and_begin_provider_submission: {
        Args: {
          p_amount: number;
          p_cost_usd: number;
          p_customer_id: string;
          p_description?: string;
          p_device_category?: string;
          p_feedback_token_hash: string;
          p_identifier_ciphertext: string;
          p_lookup_id: string;
          p_merchant_id: string;
          p_provider: string;
          p_provider_attempt_started_at: string;
          p_reference_id: string;
        };
        Returns: {
          new_balance: number;
          success: boolean;
          transaction_id: string;
        }[];
      };
      redeem_imei_wallet_payment: {
        Args: {
          p_amount: number;
          p_customer_id: string;
          p_description?: string;
          p_lookup_id: string;
          p_merchant_id: string;
        };
        Returns: {
          new_balance: number;
          success: boolean;
          transaction_id: string;
        }[];
      };
      redeem_loyalty_points: {
        Args: {
          p_customer_id: string;
          p_merchant_id: string;
          p_points: number;
          p_redemption_id: string;
          p_wallet_credit: number;
        };
        Returns: Json;
      };
      redeem_loyalty_points_legacy_rejected: {
        Args: {
          p_customer_id: string;
          p_merchant_id: string;
          p_points: number;
          p_wallet_credit: number;
        };
        Returns: Json;
      };
      redeem_points: {
        Args: {
          p_customer_id: string;
          p_merchant_id: string;
          p_order_id?: string;
          p_points: number;
        };
        Returns: {
          credit_amount: number;
          message: string;
          success: boolean;
        }[];
      };
      redeem_quiz_test_invite_v2: {
        Args: { p_token: string };
        Returns: string;
      };
      redeem_receipt_claim: { Args: { p_token_hash: string }; Returns: Json };
      redeem_receipt_claim_v2: {
        Args: { p_source: string; p_token_hash: string };
        Returns: Json;
      };
      redeem_savings_for_order: {
        Args: {
          p_amount: number;
          p_customer_id: string;
          p_goal_id: string;
          p_idempotency_key: string;
          p_merchant_id: string;
          p_order_id: string;
        };
        Returns: {
          goal_id: string;
          goal_status: string;
          redeemed_amount: number;
          redemption_id: string;
          remaining_goal_amount: number;
          success: boolean;
        }[];
      };
      redeem_vtu_wallet_payment: {
        Args: {
          p_amount: number;
          p_customer_id: string;
          p_description?: string;
          p_merchant_id: string;
          p_vtu_transaction_id: string;
        };
        Returns: {
          new_balance: number;
          success: boolean;
          transaction_id: string;
        }[];
      };
      redeem_wallet_for_order: {
        Args: {
          p_amount: number;
          p_customer_id: string;
          p_merchant_id: string;
          p_order_id: string;
          p_order_reference?: string;
        };
        Returns: {
          new_balance: number;
          redeemed_amount: number;
          success: boolean;
          transaction_id: string;
        }[];
      };
      redeem_wallet_for_remediation: {
        Args: {
          p_customer_id: string;
          p_merchant_id: string;
          p_order_id: string;
        };
        Returns: {
          currency: string;
          new_balance: number;
          success: boolean;
        }[];
      };
      refresh_analytics_views: { Args: never; Returns: undefined };
      refresh_customer_segments: {
        Args: { p_merchant_id: string };
        Returns: number;
      };
      refresh_platform_analytics_views: { Args: never; Returns: undefined };
      refresh_product_variant_media_projection: {
        Args: { p_product_id: string };
        Returns: undefined;
      };
      refund_customer_wallet_for_vtu: {
        Args: {
          p_amount: number;
          p_customer_id: string;
          p_description?: string;
          p_merchant_id: string;
          p_vtu_transaction_id: string;
        };
        Returns: {
          new_balance: number;
          success: boolean;
          transaction_id: string;
        }[];
      };
      refund_imei_wallet_payment: {
        Args: {
          p_amount: number;
          p_customer_id: string;
          p_description?: string;
          p_lookup_id: string;
          p_merchant_id: string;
        };
        Returns: {
          new_balance: number;
          success: boolean;
          transaction_id: string;
        }[];
      };
      refund_wallet_for_remediation: {
        Args: { p_order_id: string; p_reason?: string };
        Returns: boolean;
      };
      register_push_token: {
        Args: {
          p_app_type?: string;
          p_build_number?: number;
          p_device_name?: string;
          p_merchant_id: string;
          p_platform: string;
          p_shipment_update_capability?: number;
          p_token: string;
        };
        Returns: string;
      };
      release_expired_variant_inventory_reservations: {
        Args: {
          p_limit?: number;
          p_merchant_id?: string;
          p_reference_time?: string;
        };
        Returns: Json;
      };
      release_gigl_tracking_claim: {
        Args: {
          p_shipment_id: string;
          p_tracking_epoch_id: string;
          p_worker_id: string;
        };
        Returns: boolean;
      };
      release_order_inventory_units: {
        Args: {
          p_merchant_id: string;
          p_order_id: string;
          p_target_status?: string;
        };
        Returns: Json;
      };
      release_rejected_repair_pickup_reservation: {
        Args: {
          p_lock_token: string;
          p_merchant_id: string;
          p_repair_id: string;
          p_shipment_id: string;
        };
        Returns: boolean;
      };
      release_repair_pickup_booking_claim: {
        Args: {
          p_lock_token: string;
          p_merchant_id: string;
          p_repair_id: string;
        };
        Returns: boolean;
      };
      release_wallet_credit_push: {
        Args: { p_claim_token: string; p_transaction_id: string };
        Returns: boolean;
      };
      rename_merchant_slug: {
        Args: { p_merchant_id: string; p_new_slug: string };
        Returns: Json;
      };
      repairs_catalog_publicly_enabled: {
        Args: { p_merchant_id: string };
        Returns: boolean;
      };
      replace_imported_order_items: {
        Args: {
          p_expected_updated_at: string;
          p_items: Json;
          p_merchant_id: string;
          p_order_id: string;
          p_order_patch: Json;
        };
        Returns: {
          external_id: string;
          fulfillment_details: Json;
          id: string;
          shipping_address: Json;
          tracking_token: string;
          updated_at: string;
        }[];
      };
      replace_imported_order_items_suppressing_order_notifications: {
        Args: {
          p_expected_updated_at: string;
          p_items: Json;
          p_merchant_id: string;
          p_order_id: string;
          p_order_patch: Json;
        };
        Returns: {
          external_id: string;
          fulfillment_details: Json;
          id: string;
          shipping_address: Json;
          tracking_token: string;
          updated_at: string;
        }[];
      };
      replace_merchant_payment_credential_pair: {
        Args: {
          p_client_id_ciphertext: string;
          p_client_id_kek_version: number;
          p_client_id_last4: string;
          p_environment: string;
          p_merchant_id: string;
          p_provider: string;
          p_secret_key_ciphertext: string;
          p_secret_key_kek_version: number;
          p_secret_key_last4: string;
        };
        Returns: undefined;
      };
      replace_order_items: {
        Args: {
          p_is_import?: boolean;
          p_items: Json;
          p_merchant_id: string;
          p_order_id: string;
          p_order_patch?: Json;
        };
        Returns: undefined;
      };
      replace_order_items_suppressing_order_notifications: {
        Args: {
          p_items: Json;
          p_merchant_id: string;
          p_order_id: string;
          p_order_patch?: Json;
        };
        Returns: undefined;
      };
      replace_shipping_provider_service_centres: {
        Args: {
          p_centres: Json;
          p_generation: string;
          p_provider: string;
          p_synced_at: string;
        };
        Returns: number;
      };
      replay_event_deliveries_batch_admin_v2: {
        Args: { p_delivery_ids: string[]; p_replay_reason: string };
        Returns: number;
      };
      replay_event_deliveries_batch_v1: {
        Args: {
          p_delivery_ids: string[];
          p_replay_reason: string;
          p_replayed_by: string;
        };
        Returns: number;
      };
      replay_event_delivery_v1: {
        Args: {
          p_delivery_id: string;
          p_replay_reason: string;
          p_replayed_by: string;
        };
        Returns: boolean;
      };
      replay_ingress_dead_letter_v1: {
        Args: {
          p_failure_id: string;
          p_replay_reason: string;
          p_replayed_by: string;
        };
        Returns: number;
      };
      replay_ingress_dead_letter_admin_v2: {
        Args: { p_failure_id: string; p_replay_reason: string };
        Returns: number;
      };
      request_product_description_attestation_grant: {
        Args: {
          p_expected_old_description: string;
          p_expected_old_sha256: string;
          p_expected_old_source_type: string;
          p_full_replacement: boolean;
          p_merchant_id: string;
          p_operation_id: string;
          p_product_id: string;
          p_proposed_description_sha256: string;
          p_purpose: string;
        };
        Returns: {
          expires_at: string;
          grant_id: string;
        }[];
      };
      require_recent_merchant_settings_auth:
        | { Args: never; Returns: undefined }
        | { Args: { p_require_mfa: boolean }; Returns: undefined };
      reschedule_petrock_imei_lookup_poll: {
        Args: {
          p_lease_token: string;
          p_lookup_id: string;
          p_next_poll_at: string;
          p_provider_status: string;
        };
        Returns: boolean;
      };
      reschedule_petrock_remediation_order: {
        Args: {
          p_lease_token: string;
          p_next_poll_at: string;
          p_order_id: string;
          p_provider_status: string;
        };
        Returns: boolean;
      };
      reset_order_notification_outbox_dispatch: {
        Args: {
          p_claim_owner: string;
          p_event_type: string;
          p_merchant_id: string;
          p_order_id: string;
          p_outbox_id: string;
        };
        Returns: number;
      };
      reset_petrock_remediation_quote: {
        Args: { p_order_id: string; p_reason: string };
        Returns: boolean;
      };
      resolve_admin_notification_target_merchant_ids_v1: {
        Args: { p_merchant_ids: string[] };
        Returns: string[];
      };
      renew_scheduled_notification_claim_v1: {
        Args: { p_claim_token: string; p_notification_id: string };
        Returns: boolean;
      };
      mark_notification_push_unknown_v1: {
        Args: {
          p_claim_token: string;
          p_error_code: string;
          p_notification_id: string;
          p_tokens: string[];
        };
        Returns: number;
      };
      record_notification_push_acceptance_v1: {
        Args: {
          p_claim_token: string;
          p_notification_id: string;
          p_ticket_ids: string[];
          p_tokens: string[];
        };
        Returns: number;
      };
      record_notification_push_ticket_results_v1: {
        Args: {
          p_claim_token: string;
          p_error_codes: string[];
          p_notification_id: string;
          p_statuses: string[];
          p_ticket_ids: string[];
          p_tokens: string[];
        };
        Returns: number;
      };
      record_scheduled_notification_worker_health_v1: {
        Args: { p_error_code?: string; p_status: string };
        Returns: undefined;
      };
      reserve_notification_push_batch_v1: {
        Args: {
          p_claim_token: string;
          p_notification_id: string;
          p_tokens: string[];
        };
        Returns: { push_token: string }[];
      };
      snapshot_claimed_notification_audience_v1: {
        Args: { p_claim_token: string; p_notification_id: string };
        Returns: number;
      };
      resolve_public_feed_merchant: {
        Args: { p_identifier: string; p_is_by_slug?: boolean };
        Returns: {
          business_name: string;
          country: string;
          gmc_variants_enabled: boolean;
          id: string;
          logo_url: string;
          payout_currency: string;
          slug: string;
        }[];
      };
      resolve_storefront_auth_merchant: {
        Args: { p_identifier: string };
        Returns: {
          business_name: string;
          custom_domain: string;
          id: string;
          is_published: boolean;
          slug: string;
        }[];
      };
      resolve_storefront_cached_merchant: {
        Args: { p_identifier: string };
        Returns: {
          custom_domain: string;
          feature_settings: Json;
          merchant_data: Json;
        }[];
      };
      resolve_storefront_public_snapshot_v2: {
        Args: { p_identifier: string };
        Returns: {
          custom_domain: string;
          feature_settings: Json;
          merchant_data: Json;
          resolution_status: string;
        };
      };
      revoke_platform_admin_membership_v1: {
        Args: { p_confirmed: boolean; p_email: string; p_reason: string };
        Returns: {
          created_at: string | null;
          email: string;
          granted_at: string | null;
          is_legacy_owner: boolean;
          is_revocable: boolean;
          reason: string;
          revoked_at: string | null;
          role: string;
          status: string;
          updated_at: string | null;
        }[];
      };
      restock_variant_inventory_units: {
        Args: {
          p_branch_id?: string;
          p_inventory_tracking_policy?: string;
          p_merchant_id: string;
          p_product_id: string;
          p_units: Json;
          p_variant_id?: string;
        };
        Returns: Json;
      };
      resume_customer_savings_goal: {
        Args: {
          p_actor_id?: string;
          p_customer_id: string;
          p_goal_id: string;
          p_merchant_id: string;
        };
        Returns: {
          goal_status: string;
          success: boolean;
        }[];
      };
      resume_quiz_attempt_v2: {
        Args: { p_device_hash?: string; p_event_id: string };
        Returns: Json;
      };
      reverse_savings_redemption_for_order: {
        Args: {
          p_actor: string;
          p_merchant_id: string;
          p_order_id: string;
          p_reason?: string;
        };
        Returns: number;
      };
      reverse_vtu_wallet_payment: {
        Args: {
          p_merchant_id?: string;
          p_reason?: string;
          p_vtu_transaction_id: string;
        };
        Returns: {
          new_balance: number;
          reversal_transaction_id: string;
          reversed_amount: number;
          success: boolean;
        }[];
      };
      reverse_wallet_redemption: {
        Args: { p_merchant_id?: string; p_order_id: string; p_reason?: string };
        Returns: {
          new_balance: number;
          reversal_transaction_id: string;
          reversed_amount: number;
          success: boolean;
        }[];
      };
      rewrite_config_business_name: {
        Args: { cfg: Json; new_name: string; old_name: string };
        Returns: Json;
      };
      route_domain_event_v1: {
        Args: {
          p_active_destinations?: string[];
          p_destinations: string[];
          p_domain_event_id: string;
          p_queue_message_id: number;
          p_shadow?: boolean;
        };
        Returns: {
          already_routed: boolean;
          archived: boolean;
          delivery_count: number;
        }[];
      };
      sanitize_text_input: { Args: { input_text: string }; Returns: string };
      save_merchant_email_domain_registration: {
        Args: {
          p_actor_user_id: string;
          p_bounce_host: string;
          p_bounce_value: string;
          p_dkim_host: string;
          p_dkim_value: string;
          p_domain: string;
          p_merchant_id: string;
          p_status: string;
          p_verified_at: string;
          p_zeptomail_domain_id: string;
        };
        Returns: {
          bounce_host: string;
          bounce_value: string;
          dkim_host: string;
          dkim_value: string;
          domain: string;
          enabled: boolean;
          sender_local_part: string;
          status: string;
        }[];
      };
      save_merchant_email_domain_verification: {
        Args: {
          p_actor_user_id: string;
          p_bounce_host: string;
          p_bounce_value: string;
          p_checked_domain: string;
          p_checked_zeptomail_domain_id: string;
          p_dkim_host: string;
          p_dkim_value: string;
          p_merchant_id: string;
          p_status: string;
          p_verified_at: string;
          p_zeptomail_domain_id: string;
        };
        Returns: {
          bounce_host: string;
          bounce_value: string;
          dkim_host: string;
          dkim_value: string;
          domain: string;
          enabled: boolean;
          sender_local_part: string;
          status: string;
        }[];
      };
      save_mobile_admin_product_with_variants: {
        Args: {
          p_merchant_id: string;
          p_product_id: string;
          p_product_payload: Json;
          p_variant_model?: string;
          p_variants?: Json;
        };
        Returns: Json;
      };
      search_order_by_number: {
        Args: { p_merchant_id: string; p_search_term: string };
        Returns: {
          ad_tracking: Json | null;
          amount_paid: number | null;
          branch_id: string | null;
          buyer_reference: string | null;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          checkout_idempotency_key: string | null;
          checkout_request_hash: string | null;
          created_at: string | null;
          credit_notes: string | null;
          currency: string | null;
          customer_email: string | null;
          customer_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          delivered_at: string | null;
          discount_amount: number | null;
          discount_code_id: string | null;
          exchange_rate: number | null;
          external_id: string | null;
          external_source: string | null;
          firs_csid: string | null;
          firs_irn: string | null;
          firs_qr_code: string | null;
          firs_submission_status: string | null;
          firs_submitted_at: string | null;
          fulfillment_details: Json | null;
          fulfillment_notification_cycle_id: string;
          fulfillment_type: string | null;
          gift_wrapping_fee: number;
          id: string;
          import_job_id: string | null;
          import_metadata: Json;
          imported_at: string | null;
          invoice_issue_date: string | null;
          invoice_note: string | null;
          invoice_pdf_url: string | null;
          invoice_type_code: string | null;
          is_credit_order: boolean | null;
          merchant_id: string;
          notes: string | null;
          order_number: string;
          original_currency: string | null;
          original_total: number | null;
          paid_transaction_id: string | null;
          payment_due_date: string | null;
          payment_method: string | null;
          payment_status: string;
          payment_terms: string | null;
          payout_id: string | null;
          payout_status: string | null;
          purchase_order_reference: string | null;
          recorded_by_user_id: string | null;
          selected_quote_id: string | null;
          self_fulfillment_data: Json | null;
          shipment_booking_lock_token: string | null;
          shipment_booking_started_at: string | null;
          shipment_id: string | null;
          shipped_at: string | null;
          shipping_address: Json | null;
          shipping_fee: number | null;
          shipping_pickup_details: Json | null;
          shipping_provider: string | null;
          shipping_rate_id: string | null;
          shipping_rate_name: string | null;
          shipping_status: string;
          source: string | null;
          subtotal: number | null;
          tax_amount: number | null;
          tax_basis: string | null;
          tax_exclusive_amount: number | null;
          tax_inclusive_amount: number | null;
          tax_point_date: string | null;
          total: number;
          tracking_number: string | null;
          tracking_token: string;
          transaction_date: string | null;
          updated_at: string | null;
          wallet_amount_used: number | null;
          wallet_transaction_id: string | null;
        }[];
        SetofOptions: {
          from: '*';
          to: 'orders';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      search_products_v2: {
        Args: {
          brand_filter?: string;
          category_id_filter?: string;
          condition_filter?: string;
          max_price_filter?: number;
          merchant_id_param: string;
          min_price_filter?: number;
          min_rating_filter?: number;
          parent_only?: boolean;
          result_limit?: number;
          result_offset?: number;
          search_query: string;
          sort_by?: string;
          status_filter?: string;
          stock_filter?: string;
        };
        Returns: {
          product_id: string;
          relevance: number;
          total_count: number;
        }[];
      };
      select_event_pipeline_replay_ids_admin_v2: {
        Args: {
          p_destination: string;
          p_error_code?: string;
          p_from?: string;
          p_merchant_id?: string;
          p_status: string;
          p_to?: string;
        };
        Returns: string[];
      };
      select_event_pipeline_replay_ids_v1: {
        Args: {
          p_destination: string;
          p_error_code?: string;
          p_from?: string;
          p_merchant_id?: string;
          p_status: string;
          p_to?: string;
        };
        Returns: string[];
      };
      send_notification_to_all_merchants: {
        Args: { p_notification_id: string };
        Returns: number;
      };
      send_notification_to_merchants: {
        Args: { p_merchant_ids: string[]; p_notification_id: string };
        Returns: number;
      };
      set_credit_direct_session: {
        Args: {
          p_checkout_token: string;
          p_merchant_id: string;
          p_order_id: string;
          p_session_id: string;
          p_signed_amount: number;
        };
        Returns: boolean;
      };
      set_google_ads_customer: {
        Args: {
          p_expected_access_token_ciphertext: string | null;
          p_merchant_id: string;
          p_provider_customer_id: string;
        };
        Returns: boolean;
      };
      update_google_ads_connection_token: {
        Args: {
          p_access_token_ciphertext: string;
          p_merchant_id: string;
          p_token_expires_at: string | null;
        };
        Returns: boolean;
      };
      update_google_ads_connection_token_if_current: {
        Args: {
          p_access_token_ciphertext: string;
          p_expected_access_token_ciphertext: string | null;
          p_expected_refresh_token_ciphertext: string | null;
          p_merchant_id: string;
          p_token_expires_at: string | null;
        };
        Returns: boolean;
      };
      upsert_google_ads_connection: {
        Args: {
          p_access_token_ciphertext: string;
          p_merchant_id: string;
          p_provider_customer_id: string | null;
          p_refresh_token_ciphertext: string;
          p_scopes: string[];
          p_status: string;
          p_token_expires_at: string | null;
        };
        Returns: string;
      };
      upsert_google_ads_spend_daily: {
        Args: { p_merchant_id: string; p_rows: Json };
        Returns: number;
      };
      replace_google_ads_spend_daily: {
        Args: {
          p_end_date: string;
          p_merchant_id: string;
          p_provider_customer_id: string;
          p_rows: Json;
          p_start_date: string;
          p_sync_run_id: string;
        };
        Returns: number;
      };
      mark_google_ads_connection_synced: {
        Args: { p_merchant_id: string };
        Returns: boolean;
      };
      mark_google_ads_connection_reauth_if_current: {
        Args: {
          p_access_token_ciphertext: string | null;
          p_merchant_id: string;
          p_reason: string;
          p_refresh_token_ciphertext: string | null;
        };
        Returns: boolean;
      };
      delete_google_ads_connection: {
        Args: { p_merchant_id: string };
        Returns: boolean;
      };
      delete_merchant_ads_connection: {
        Args: { p_merchant_id: string; p_provider: string };
        Returns: boolean;
      };
      mark_merchant_ads_connection_synced: {
        Args: { p_merchant_id: string; p_provider: string };
        Returns: boolean;
      };
      mark_merchant_ads_connection_synced_if_current: {
        Args: {
          p_merchant_id: string;
          p_provider: string;
          p_provider_customer_id: string;
          p_sync_run_id: string;
          p_sync_window_end_date: string;
          p_sync_window_start_date: string;
        };
        Returns: boolean;
      };
      mark_merchant_ads_connection_sync_started_if_current: {
        Args: {
          p_merchant_id: string;
          p_provider: string;
          p_provider_customer_id: string;
          p_sync_run_id: string;
          p_sync_run_started_at: string;
          p_sync_window_end_date: string;
          p_sync_window_start_date: string;
        };
        Returns: boolean;
      };
      get_merchant_ads_sync_run_started_at: {
        Args: {
          p_merchant_id: string;
          p_provider: string;
          p_sync_run_id: string;
        };
        Returns: string | null;
      };
      mark_merchant_ads_connection_reauth: {
        Args: { p_merchant_id: string; p_reason: string };
        Returns: boolean;
      };
      mark_merchant_ads_connection_reauth_if_current: {
        Args: {
          p_access_token_ciphertext: string | null;
          p_merchant_id: string;
          p_provider: string;
          p_reason: string;
          p_refresh_token_ciphertext: string | null;
        };
        Returns: boolean;
      };
      set_merchant_ads_account: {
        Args: {
          p_account_timezone: string | null;
          p_attribution_metadata: Json | null;
          p_expected_access_token_ciphertext: string | null;
          p_merchant_id: string;
          p_provider: string;
          p_provider_account_label: string | null;
          p_provider_customer_id: string;
        };
        Returns: boolean;
      };
      update_merchant_ads_connection_token: {
        Args: {
          p_access_token_ciphertext: string;
          p_merchant_id: string;
          p_provider: string;
          p_token_expires_at: string | null;
        };
        Returns: boolean;
      };
      update_snapchat_ads_connection_tokens: {
        Args: {
          p_access_token_ciphertext: string;
          p_current_refresh_token_ciphertext: string;
          p_merchant_id: string;
          p_refresh_token_ciphertext: string;
          p_token_expires_at: string | null;
        };
        Returns: boolean;
      };
      upsert_merchant_ads_connection: {
        Args: {
          p_access_token_ciphertext: string;
          p_account_timezone: string | null;
          p_attribution_metadata: Json | null;
          p_merchant_id: string;
          p_metadata: Json | null;
          p_provider: string;
          p_provider_account_label: string | null;
          p_provider_customer_id: string | null;
          p_refresh_token_ciphertext: string | null;
          p_scopes: string[] | null;
          p_status: string;
          p_token_expires_at: string | null;
        };
        Returns: string;
      };
      replace_merchant_ads_spend_daily_window: {
        Args: {
          p_end_date: string;
          p_merchant_id: string;
          p_provider: string;
          p_provider_customer_id: string;
          p_rows: Json;
          p_start_date: string;
          p_sync_run_id: string;
        };
        Returns: number;
      };
      upsert_merchant_ads_spend_daily: {
        Args: { p_merchant_id: string; p_provider: string; p_rows: Json };
        Returns: number;
      };
      set_customer_date_of_birth: {
        Args: { p_date_of_birth: string; p_merchant_id: string };
        Returns: string;
      };
      set_customer_username: {
        Args: { p_merchant_id: string; p_username: string };
        Returns: string;
      };
      set_customer_username_v2: {
        Args: { p_merchant_id: string; p_username: string };
        Returns: Json;
      };
      set_merchant_email_domain_enabled: {
        Args: {
          p_actor_user_id: string;
          p_enabled: boolean;
          p_merchant_id: string;
        };
        Returns: {
          bounce_host: string;
          bounce_value: string;
          dkim_host: string;
          dkim_value: string;
          domain: string;
          enabled: boolean;
          sender_local_part: string;
          status: string;
        }[];
      };
      set_merchant_payment_credential: {
        Args: {
          p_ciphertext: string;
          p_credential_role: string;
          p_environment: string;
          p_kek_version: number;
          p_key_last4?: string;
          p_merchant_id: string;
          p_provider: string;
        };
        Returns: string;
      };
      set_merchant_virtual_terminal_code_if_absent: {
        Args: { p_code: string; p_merchant_id: string };
        Returns: undefined;
      };
      set_order_payment_ref: {
        Args: {
          p_gateway?: string;
          p_order_id: string;
          p_payment_ref: string;
          p_tracking_token?: string;
        };
        Returns: boolean;
      };
      set_petrock_eligibility_outcome: {
        Args: {
          p_carrier: string;
          p_customer_message: string;
          p_device_model: string;
          p_failure_reason?: string;
          p_order_id: string;
          p_status: string;
          p_status_segment: string;
        };
        Returns: boolean;
      };
      set_primary_domain: {
        Args: { domain_id_param: string; merchant_id_param: string };
        Returns: undefined;
      };
      set_vtu_transaction_voucher_pin: {
        Args: { p_transaction_id: string; p_voucher_pin: string };
        Returns: undefined;
      };
      smart_product_search: {
        Args: {
          merchant_id_param: string;
          result_limit?: number;
          search_query: string;
        };
        Returns: {
          brand: string;
          category: string;
          description: string;
          id: string;
          image_large: string;
          image_small: string;
          name: string;
          price: number;
          relevance: number;
        }[];
      };
      start_quiz_attempt: {
        Args: {
          p_event_id: string;
          p_integrity_tier: string;
          p_route_proof?: Json;
          p_user_id?: string;
        };
        Returns: Json;
      };
      start_quiz_attempt_v2: {
        Args: {
          p_accepted_rules_version: string;
          p_app_version: string;
          p_event_id: string;
          p_integrity_tier: string;
          p_platform: string;
          p_route_proof: Json;
          p_start_request_id: string;
          p_terms_accepted: boolean;
          p_user_id: string;
        };
        Returns: Json;
      };
      start_quiz_attempt_with_device: {
        Args: {
          p_device_hash: string;
          p_device_route_proof: Json;
          p_event_id: string;
          p_integrity_tier: string;
          p_start_route_proof: Json;
          p_user_id: string;
        };
        Returns: Json;
      };
      start_quiz_attempt_with_device_v2: {
        Args: {
          p_accepted_rules_version: string;
          p_app_version: string;
          p_device_hash: string;
          p_device_route_proof: Json;
          p_event_id: string;
          p_integrity_tier: string;
          p_platform: string;
          p_start_request_id: string;
          p_start_route_proof: Json;
          p_terms_accepted: boolean;
          p_user_id: string;
        };
        Returns: Json;
      };
      storefront_merchant_has_paystack_subaccount: {
        Args: { p_merchant_id: string };
        Returns: boolean;
      };
      submit_quiz_answer: {
        Args: {
          p_answer: string;
          p_attempt_id: string;
          p_client_answered_at?: string;
          p_integrity_tier?: string;
          p_question_id: string;
          p_route_proof?: Json;
          p_user_id?: string;
        };
        Returns: Json;
      };
      submit_quiz_answer_v2: {
        Args: {
          p_answer: string;
          p_attempt_id: string;
          p_client_answered_at?: string;
          p_question_id: string;
          p_route_proof: Json;
          p_user_id: string;
        };
        Returns: Json;
      };
      subscribe_newsletter: {
        Args: { p_email: string; p_merchant_id?: string; p_source?: string };
        Returns: string;
      };
      swap_customer_savings_goal_device: {
        Args: {
          p_actor_id: string;
          p_customer_id: string;
          p_goal_id: string;
          p_merchant_id: string;
          p_product_id: string;
          p_product_snapshot: Json;
          p_target_amount: number;
          p_title: string;
          p_variant_id: string;
        };
        Returns: {
          current_amount: number;
          goal_id: string;
          goal_status: string;
          success: boolean;
          target_amount: number;
        }[];
      };
      sync_petrock_imei_provider_products: {
        Args: { p_rows: Json };
        Returns: number;
      };
      sync_petrock_remediation_products: {
        Args: { p_rows: Json };
        Returns: number;
      };
      sync_product_variants_for_product: {
        Args: { p_merchant_id: string; p_product_id: string; p_variants: Json };
        Returns: number;
      };
      sync_virtual_terminal_local: {
        Args: {
          p_account_name?: string;
          p_account_number?: string;
          p_active?: boolean;
          p_bank?: string;
          p_code: string;
          p_merchant_id: string;
          p_name?: string;
        };
        Returns: string;
      };
      terminalize_due_live_quiz_events_v2: { Args: never; Returns: Json };
      unsubscribe_newsletter: {
        Args: { p_email: string; p_merchant_id?: string };
        Returns: boolean;
      };
      update_admin_order: {
        Args: { p_order_id: string; p_payload: Json };
        Returns: Json;
      };
      update_admin_order_with_transaction_discount_metadata: {
        Args: { p_order_id: string; p_payload: Json };
        Returns: Json;
      };
      update_inventory_tracking_policy: {
        Args: {
          p_inventory_tracking_policy: string;
          p_merchant_id: string;
          p_product_id: string;
          p_variant_id?: string;
        };
        Returns: Json;
      };
      update_merchant_identity_settings: {
        Args: {
          p_expected_updated_at: string;
          p_merchant_id: string;
          p_settings: Json;
        };
        Returns: Json;
      };
      update_merchant_social_media: {
        Args: {
          p_clear?: boolean;
          p_merchant_id: string;
          p_settings?: Json;
          p_social_media?: Json;
        };
        Returns: Json;
      };
      update_merchant_social_media_internal: {
        Args: {
          p_clear?: boolean;
          p_merchant_id: string;
          p_settings?: Json;
          p_social_media?: Json;
        };
        Returns: Json;
      };
      update_transaction_review_details: {
        Args: {
          p_client_timezone?: string;
          p_cost_price: number;
          p_identifier_type?: string;
          p_identifier_value?: string;
          p_merchant_id: string;
          p_order_id: string;
          p_order_item_id: string;
          p_product_id: string;
          p_supplier_name: string;
          p_transaction_date: string;
          p_unit_index?: number;
          p_update_product_default?: boolean;
          p_variant_id: string;
        };
        Returns: undefined;
      };
      update_variant_inventory_unit: {
        Args: {
          p_branch_id?: string;
          p_identifier_value?: string;
          p_merchant_id: string;
          p_notes?: string;
          p_set_branch?: boolean;
          p_status?: string;
          p_unit_id: string;
        };
        Returns: Json;
      };
      update_admin_platform_settings_v1: {
        Args: { p_settings: Json };
        Returns: undefined;
      };
      upsert_platform_admin_membership_v1: {
        Args: {
          p_confirmed: boolean;
          p_email: string;
          p_reactivate?: boolean;
          p_reason: string;
          p_role: Database['public']['Enums']['platform_admin_role'];
        };
        Returns: {
          created_at: string | null;
          email: string;
          granted_at: string | null;
          is_legacy_owner: boolean;
          is_revocable: boolean;
          reason: string;
          revoked_at: string | null;
          role: string;
          status: string;
          updated_at: string | null;
        }[];
      };
      upsert_customer_on_auth: {
        Args: {
          p_email: string;
          p_full_name?: string;
          p_merchant_id: string;
          p_phone?: string;
          p_user_id: string;
        };
        Returns: string;
      };
      upsert_customer_saved_address_from_order: {
        Args: {
          p_customer_id: string;
          p_customer_name: string;
          p_customer_phone: string;
          p_shipping_address: Json;
        };
        Returns: undefined;
      };
      validate_order_number: { Args: { order_num: string }; Returns: boolean };
      validate_order_shipment_inventory: {
        Args: {
          p_external_units?: Json;
          p_merchant_id: string;
          p_order_id: string;
        };
        Returns: Json;
      };
      write_admin_reconciliation_export_event_v1: {
        Args: never;
        Returns: string;
      };
      write_platform_audit_export_event_v1: {
        Args: never;
        Returns: string;
      };
    };
    Enums: {
      negotiation_status: 'pending' | 'accepted' | 'rejected' | 'countered';
      platform_admin_role:
        | 'owner'
        | 'finance'
        | 'operations'
        | 'support'
        | 'content'
        | 'viewer';
      repair_status:
        | 'pending'
        | 'confirmed'
        | 'in_progress'
        | 'completed'
        | 'cancelled'
        | 'rejected';
      staff_role:
        | 'admin'
        | 'manager'
        | 'sales_rep'
        | 'inventory'
        | 'accountant'
        | 'customer_service'
        | 'marketing'
        | 'fulfillment'
        | 'blog_manager';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  'public'
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      negotiation_status: ['pending', 'accepted', 'rejected', 'countered'],
      platform_admin_role: [
        'owner',
        'finance',
        'operations',
        'support',
        'content',
        'viewer',
      ],
      repair_status: [
        'pending',
        'confirmed',
        'in_progress',
        'completed',
        'cancelled',
        'rejected',
      ],
      staff_role: [
        'admin',
        'manager',
        'sales_rep',
        'inventory',
        'accountant',
        'customer_service',
        'marketing',
        'fulfillment',
        'blog_manager',
      ],
    },
  },
} as const;
