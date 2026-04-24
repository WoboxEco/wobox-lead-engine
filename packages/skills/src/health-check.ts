import { createAdminClient, env } from '@wobox/core';

export interface HealthCheckOptions {
  skipNet?: boolean;
}

type CheckResult = { name: string; status: 'ok' | 'warn' | 'fail'; detail: string };

export async function run(opts: HealthCheckOptions): Promise<void> {
  const results: CheckResult[] = [];

  // 1. Env vars (el env() ya valida schema, asi que si llegamos aca esta OK; chequeamos optionals)
  let e: ReturnType<typeof env>;
  try {
    e = env();
    results.push({ name: 'env schema', status: 'ok', detail: `NODE_ENV=${e.NODE_ENV}` });
  } catch (err) {
    results.push({ name: 'env schema', status: 'fail', detail: String(err) });
    printResults(results);
    return;
  }

  results.push(
    e.ANTHROPIC_API_KEY
      ? { name: 'ANTHROPIC_API_KEY', status: 'ok', detail: `set (model=${e.CLAUDE_MODEL})` }
      : { name: 'ANTHROPIC_API_KEY', status: 'warn', detail: 'no configurada (score/generate no funcionan)' },
  );
  results.push(
    e.APOLLO_API_KEY
      ? { name: 'APOLLO_API_KEY', status: 'ok', detail: 'set' }
      : { name: 'APOLLO_API_KEY', status: 'warn', detail: 'no configurada (check-warm-path --auto no funciona)' },
  );
  results.push(
    e.APIFY_API_TOKEN
      ? { name: 'APIFY_API_TOKEN', status: 'ok', detail: 'set' }
      : { name: 'APIFY_API_TOKEN', status: 'warn', detail: 'no configurada (search-leads-web y enrich-lead no funcionan)' },
  );
  results.push(
    e.HUBSPOT_PRIVATE_APP_TOKEN
      ? { name: 'HUBSPOT_PRIVATE_APP_TOKEN', status: 'ok', detail: 'set' }
      : { name: 'HUBSPOT_PRIVATE_APP_TOKEN', status: 'warn', detail: 'no configurada (sync-hubspot no funciona)' },
  );
  results.push(
    e.CALENDLY_SIGNING_KEY
      ? { name: 'CALENDLY_SIGNING_KEY', status: 'ok', detail: 'set' }
      : { name: 'CALENDLY_SIGNING_KEY', status: 'warn', detail: 'no configurada (webhook Calendly rechaza todo)' },
  );

  // 2. Supabase reachability
  if (!opts.skipNet) {
    try {
      const db = createAdminClient();
      const { error, count } = await db
        .from('companies')
        .select('id', { count: 'exact', head: true });
      if (error) {
        results.push({ name: 'supabase', status: 'fail', detail: error.message });
      } else {
        results.push({
          name: 'supabase',
          status: 'ok',
          detail: `companies count=${count ?? '?'}`,
        });
      }
    } catch (err) {
      results.push({ name: 'supabase', status: 'fail', detail: String(err) });
    }
  }

  // 3. Apollo auth/health (gratis, no gasta creditos)
  if (!opts.skipNet && e.APOLLO_API_KEY) {
    try {
      const res = await fetch(`${e.APOLLO_BASE_URL}/auth/health`, {
        method: 'GET',
        headers: { 'X-Api-Key': e.APOLLO_API_KEY, 'Cache-Control': 'no-cache' },
      });
      if (res.ok) {
        const data = (await res.json()) as { healthy?: boolean; is_logged_in?: boolean };
        results.push({
          name: 'apollo',
          status: data.healthy && data.is_logged_in ? 'ok' : 'warn',
          detail: `healthy=${data.healthy} logged_in=${data.is_logged_in}`,
        });
      } else {
        results.push({ name: 'apollo', status: 'fail', detail: `HTTP ${res.status}` });
      }
    } catch (err) {
      results.push({ name: 'apollo', status: 'fail', detail: String(err) });
    }
  }

  // 4. HubSpot reachability
  if (!opts.skipNet && e.HUBSPOT_PRIVATE_APP_TOKEN) {
    try {
      const res = await fetch('https://api.hubapi.com/integrations/v1/me', {
        headers: { Authorization: `Bearer ${e.HUBSPOT_PRIVATE_APP_TOKEN}` },
      });
      results.push({
        name: 'hubspot',
        status: res.ok ? 'ok' : 'fail',
        detail: res.ok ? 'auth ok' : `HTTP ${res.status}`,
      });
    } catch (err) {
      results.push({ name: 'hubspot', status: 'fail', detail: String(err) });
    }
  }

  // 5. Apify reachability (user info)
  if (!opts.skipNet && e.APIFY_API_TOKEN) {
    try {
      const res = await fetch(
        `https://api.apify.com/v2/users/me?token=${e.APIFY_API_TOKEN}`,
      );
      if (res.ok) {
        const data = (await res.json()) as {
          data?: { username?: string; plan?: string | { id?: string } };
        };
        const plan =
          typeof data.data?.plan === 'string'
            ? data.data.plan
            : (data.data?.plan?.id ?? '?');
        results.push({
          name: 'apify',
          status: 'ok',
          detail: `user=${data.data?.username ?? '?'} plan=${plan}`,
        });
      } else {
        results.push({ name: 'apify', status: 'fail', detail: `HTTP ${res.status}` });
      }
    } catch (err) {
      results.push({ name: 'apify', status: 'fail', detail: String(err) });
    }
  }

  printResults(results);

  const hasFail = results.some((r) => r.status === 'fail');
  if (hasFail) process.exitCode = 1;
}

function printResults(results: CheckResult[]): void {
  console.log('\nHealth check\n' + '='.repeat(60));
  for (const r of results) {
    const icon = r.status === 'ok' ? '[ok]' : r.status === 'warn' ? '[warn]' : '[FAIL]';
    console.log(`${icon.padEnd(7)} ${r.name.padEnd(28)} ${r.detail}`);
  }
  const ok = results.filter((r) => r.status === 'ok').length;
  const warn = results.filter((r) => r.status === 'warn').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  console.log('-'.repeat(60));
  console.log(`${ok} ok | ${warn} warn | ${fail} fail`);
}
