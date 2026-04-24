import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type DbClient,
  VENTURES,
  type Venture,
  createAdminClient,
  createLogger,
} from '@wobox/core';

export interface ImportCsvOptions {
  file?: string;
  venture?: string;
  dryRun?: boolean;
  update?: boolean;
}

// Columnas reconocidas (todas opcionales excepto name y venture).
const COMPANY_COLS = [
  'name',
  'venture',
  'website',
  'instagram_handle',
  'linkedin_url',
  'vertical',
  'subsector',
  'neighborhood',
  'region',
  'buyer_persona',
  'locations_count',
  'is_franchise',
  'franchise_type',
  'source',
  'apollo_id',
  'hubspot_id',
];
const CONTACT_COLS = [
  'contact_name',
  'contact_email',
  'contact_role',
  'contact_linkedin',
  'contact_phone',
  'warm_path',
  'warm_connector',
  'is_decision_maker',
];

export async function run(opts: ImportCsvOptions): Promise<void> {
  const log = createLogger('import-csv');
  if (!opts.file) {
    throw new Error('Requiere --file=<path.csv>');
  }
  const path = resolve(process.cwd(), opts.file);
  const raw = readFileSync(path, 'utf8');
  const { headers, rows } = parseCsv(raw);

  if (!headers.includes('name')) throw new Error('Falta columna requerida: name');
  const requiresVenture = !opts.venture && !headers.includes('venture');
  if (requiresVenture) {
    throw new Error('Falta venture: agregar columna "venture" al CSV o pasar --venture=<loop|wobox_food|wobox_fashion>');
  }

  console.log(`\nParseados ${rows.length} rows del CSV: ${path}`);
  console.log(`Columnas detectadas: ${headers.join(', ')}`);
  if (opts.dryRun) console.log('--dry-run: no se insertara nada');
  console.log();

  const db = createAdminClient();

  let inserted = 0;
  let updated = 0;
  let duplicated = 0;
  let failed = 0;
  let contactsInserted = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const company = buildCompany(headers, row, opts.venture);

    const validation = validateCompany(company);
    if (validation) {
      console.log(`[row ${i + 2}] skip: ${validation}`);
      failed++;
      continue;
    }

    if (opts.dryRun) {
      console.log(`[row ${i + 2}] ${company.name} (${company.venture}) -> OK (dry)`);
      inserted++;
      continue;
    }

    const existingId = await findExistingCompany(db, company);
    let companyId: string;

    if (existingId) {
      if (opts.update) {
        const { error } = await db.from('companies').update(company).eq('id', existingId);
        if (error) {
          console.log(`[row ${i + 2}] ${company.name}: update FAIL ${error.message}`);
          failed++;
          continue;
        }
        updated++;
        companyId = existingId;
        console.log(`[row ${i + 2}] ${company.name}: updated`);
      } else {
        duplicated++;
        companyId = existingId;
        console.log(`[row ${i + 2}] ${company.name}: ya existe (use --update para sobreescribir)`);
      }
    } else {
      const { data, error } = await db
        .from('companies')
        .insert({ ...company, source: company.source ?? 'csv' })
        .select('id')
        .single();
      if (error || !data) {
        console.log(`[row ${i + 2}] ${company.name}: insert FAIL ${error?.message}`);
        failed++;
        continue;
      }
      companyId = (data as { id: string }).id;
      inserted++;
      console.log(`[row ${i + 2}] ${company.name}: inserted`);
    }

    // Si trae contact, insertar tambien.
    const contact = buildContact(headers, row, companyId);
    if (contact && !opts.dryRun) {
      const { error } = await db.from('contacts').insert(contact);
      if (error) {
        log.warn({ err: error.message, company: company.name }, 'contact insert failed');
      } else {
        contactsInserted++;
      }
    }
  }

  console.log('\nResumen:');
  console.log(`  inserted:          ${inserted}`);
  console.log(`  updated:           ${updated}`);
  console.log(`  duplicated (skip): ${duplicated}`);
  console.log(`  failed:            ${failed}`);
  console.log(`  contacts:          ${contactsInserted}`);
}

// ========================
// CSV parsing
// ========================

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function parseCsv(raw: string): ParsedCsv {
  const lines = splitCsvLines(raw);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === '') continue;
    rows.push(parseCsvLine(line));
  }
  return { headers, rows };
}

// Split respetando comillas con newlines embebidos.
function splitCsvLines(raw: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      if (inQ && raw[i + 1] === '"') {
        cur += '""';
        i++;
      } else {
        inQ = !inQ;
        cur += ch;
      }
    } else if ((ch === '\n' || ch === '\r') && !inQ) {
      if (cur.length > 0) out.push(cur);
      cur = '';
      if (ch === '\r' && raw[i + 1] === '\n') i++;
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQ = true;
      } else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

// ========================
// Row -> company / contact
// ========================

type CompanyInsert = Record<string, unknown> & {
  name: string;
  venture: Venture;
  source?: string;
};

function buildCompany(
  headers: string[],
  row: string[],
  defaultVenture: string | undefined,
): CompanyInsert {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < headers.length; i++) {
    const key = headers[i]!;
    const val = row[i] ?? '';
    if (!COMPANY_COLS.includes(key)) continue;
    if (val === '') continue;

    if (key === 'locations_count') {
      const n = Number(val);
      if (!Number.isNaN(n)) obj[key] = n;
      continue;
    }
    if (key === 'is_franchise') {
      obj[key] = /^(true|1|yes|si)$/i.test(val);
      continue;
    }
    if (key === 'instagram_handle') {
      obj[key] = val.replace(/^@/, '').toLowerCase();
      continue;
    }
    obj[key] = val;
  }
  if (!obj.venture && defaultVenture) obj.venture = defaultVenture;
  return obj as CompanyInsert;
}

function validateCompany(c: CompanyInsert): string | null {
  if (!c.name || typeof c.name !== 'string') return 'name vacio';
  if (!c.venture) return 'venture vacio';
  if (!VENTURES.includes(c.venture)) {
    return `venture invalido: "${c.venture}" (use ${VENTURES.join('|')})`;
  }
  return null;
}

type ContactInsert = Record<string, unknown> & {
  company_id: string;
  name: string;
};

function buildContact(
  headers: string[],
  row: string[],
  companyId: string,
): ContactInsert | null {
  const get = (key: string): string | null => {
    const idx = headers.indexOf(key);
    if (idx < 0) return null;
    const v = (row[idx] ?? '').trim();
    return v.length > 0 ? v : null;
  };

  if (!CONTACT_COLS.some((k) => headers.includes(k))) return null;

  const name = get('contact_name');
  if (!name) return null;

  const contact: ContactInsert = {
    company_id: companyId,
    name,
    contact_source: 'csv',
  };
  const email = get('contact_email');
  if (email) contact.email = email.toLowerCase();
  const role = get('contact_role');
  if (role) contact.role = role;
  const linkedin = get('contact_linkedin');
  if (linkedin) contact.linkedin_url = linkedin;
  const phone = get('contact_phone');
  if (phone) contact.phone = phone;

  const warmPath = get('warm_path');
  if (warmPath === 'direct' || warmPath === '2nd_degree' || warmPath === 'none') {
    contact.warm_path = warmPath;
  }
  const connector = get('warm_connector');
  if (connector) contact.warm_connector = connector;
  const isDm = get('is_decision_maker');
  if (isDm) contact.is_decision_maker = /^(true|1|yes|si)$/i.test(isDm);

  return contact;
}

// ========================
// Dedup lookup
// ========================

async function findExistingCompany(db: DbClient, c: CompanyInsert): Promise<string | null> {
  // 1. linkedin_url (unique index)
  if (c.linkedin_url) {
    const { data } = await db
      .from('companies')
      .select('id')
      .eq('linkedin_url', c.linkedin_url)
      .maybeSingle();
    if (data) return (data as { id: string }).id;
  }
  // 2. website normalized
  if (c.website) {
    const normalized = String(c.website)
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?/, '')
      .replace(/\/$/, '');
    if (normalized) {
      const { data } = await db
        .from('companies')
        .select('id')
        .eq('website_normalized', normalized)
        .maybeSingle();
      if (data) return (data as { id: string }).id;
    }
  }
  // 3. instagram + venture
  if (c.instagram_handle) {
    const { data } = await db
      .from('companies')
      .select('id')
      .eq('instagram_handle', c.instagram_handle)
      .eq('venture', c.venture)
      .maybeSingle();
    if (data) return (data as { id: string }).id;
  }
  // 4. name + venture (case-insensitive)
  const { data } = await db
    .from('companies')
    .select('id')
    .ilike('name', c.name)
    .eq('venture', c.venture)
    .maybeSingle();
  if (data) return (data as { id: string }).id;

  return null;
}
