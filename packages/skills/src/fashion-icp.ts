/**
 * ICP de Wobox Fashion para sourcing con Apollo: industrias (filtro duro por tag ID + lista
 * permitida del pre-filtro) y términos negativos. Funciones puras, sin red ni DB.
 */

export const FASHION_SUBSECTORS = ['ropa', 'calzado', 'muebles_deco', 'todos'] as const;
export type FashionSubsector = (typeof FASHION_SUBSECTORS)[number];

/** Industrias de moda (taxonomía LinkedIn/Apollo). */
const FASHION_INDUSTRIES = [
  'apparel & fashion',
  'retail apparel and fashion',
  'footwear',
  'fashion accessories',
  'luxury goods & jewelry',
];

const HOME_INDUSTRIES = ['furniture', 'home furnishings', 'retail furniture and home furnishings'];

/** Industrias que se mandan a Apollo como `organization_industry_tag_ids` por rubro. */
export const FASHION_INDUSTRIES_BY_SUBSECTOR: Record<FashionSubsector, string[]> = {
  todos: FASHION_INDUSTRIES,
  ropa: FASHION_INDUSTRIES,
  calzado: FASHION_INDUSTRIES,
  muebles_deco: HOME_INDUSTRIES,
};

/** Keywords text-match (solo se usan si no se pudieron resolver los tag IDs). */
export const FASHION_KEYWORDS_BY_SUBSECTOR: Record<FashionSubsector, string> = {
  todos: 'apparel fashion clothing moda indumentaria calzado carteras',
  ropa: 'ropa indumentaria moda apparel clothing',
  calzado: 'calzado zapatillas zapatos footwear carteras',
  muebles_deco: 'muebles decoracion deco hogar textil furniture home',
};

/** Rango de empleados del ICP (11–500). */
export const FASHION_EMPLOYEE_RANGES = ['11,50', '51,200', '201,500'];

/**
 * Industrias que además de las del filtro se toleran en el pre-filtro (Apollo a veces clasifica
 * marcas de ropa con estas). Los términos negativos siguen aplicando.
 */
const TOLERATED_FASHION = ['textiles', 'retail', 'consumer goods', 'sporting goods', 'cosmetics'];
const TOLERATED_HOME = ['retail', 'interior design', 'textiles', 'consumer goods'];

/** Términos (prefijos de palabra, sin acentos) que delatan rubros ajenos aunque digan "moda". */
export const NEGATIVE_TERMS = [
  'pizz',
  'restaurant',
  'restoran',
  'gastronom',
  'parrilla',
  'cafeteria',
  'club',
  'deportivo',
  'futbol',
  'optica',
  'anteojo',
  'recicl',
  'recycl',
  'plastic',
  'industrial',
  'metal',
  'steel',
  'acero',
  'siderurg',
  'mineria',
  'mining',
  'software',
  'consultor',
  'consulting',
  'logistic',
  'inmobiliar',
  'real estate',
  'seguros',
  'insurance',
  'banco',
  'bank',
  'financ',
  'bodega',
  'vino',
  'wine',
  'ferreter',
  'hardware',
  'construc',
  'transporte',
  'farmac',
  'laboratorio',
  'agro',
  'quimic',
  'packaging',
  'envases',
];

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function allowedIndustries(subsector: FashionSubsector): Set<string> {
  const tolerated = subsector === 'muebles_deco' ? TOLERATED_HOME : TOLERATED_FASHION;
  return new Set([...FASHION_INDUSTRIES_BY_SUBSECTOR[subsector], ...tolerated].map(norm));
}

export interface IcpOrgFields {
  name?: string | null;
  website_url?: string | null;
  primary_domain?: string | null;
  industry?: string | null;
  keywords?: string[] | null;
}

export type IcpVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Pre-filtro sin IA: descarta si la industria de Apollo no está permitida para el rubro o si
 * nombre/dominio/keywords/industria contienen términos negativos. Sin industria → se evalúan
 * solo los términos negativos.
 */
export function checkFashionIcp(org: IcpOrgFields, subsector: FashionSubsector): IcpVerdict {
  const industry = org.industry ? norm(org.industry) : '';
  if (industry && !allowedIndustries(subsector).has(industry)) {
    return { ok: false, reason: `industria fuera de rubro: ${org.industry}` };
  }
  const haystack = norm(
    [org.name, org.website_url, org.primary_domain, org.industry, ...(org.keywords ?? [])]
      .filter(Boolean)
      .join(' | '),
  );
  // Match al inicio de palabra ("agro" no debe pegarle a "Milagros").
  const words = ` ${haystack}`;
  const hit = NEGATIVE_TERMS.find((t) => words.includes(` ${t}`));
  if (hit) return { ok: false, reason: `término negativo: ${hit}` };
  return { ok: true };
}
