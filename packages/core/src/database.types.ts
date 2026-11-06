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

/**
 * Columnas de canales de contacto en `companies` (migration 0011_contact_channels).
 * El placeholder de arriba no tipa columnas; este shape sirve para castear selects
 * hasta que `pnpm db:types` regenere los tipos reales.
 */
export interface CompanyContactChannelsRow {
  phone: string | null;
  whatsapp: string | null;
  generic_email: string | null;
  enriched_at: string | null;
}
