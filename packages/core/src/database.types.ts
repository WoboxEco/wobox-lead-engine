// Placeholder generado tras correr `pnpm db:types`.
// Shape compatible con supabase-js generics: permite insert/update sin inferir `never`.
// Al correr setup-database se reemplaza con los tipos reales.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type GenericTable = {
  Row: Record<string, unknown>;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      companies: GenericTable;
      contacts: GenericTable;
      scores: GenericTable;
      interactions: GenericTable;
      messages: GenericTable;
      campaigns: GenericTable;
      error_logs: GenericTable;
      api_usage: GenericTable;
      sourcing_cursors: GenericTable;
    };
    Views: Record<string, { Row: Record<string, unknown>; Relationships: [] }>;
    Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }>;
    Enums: Record<string, string>;
    CompositeTypes: Record<string, never>;
  };
}
