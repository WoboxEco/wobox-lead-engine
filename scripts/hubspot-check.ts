import { env } from '../packages/core/src/index.js';

async function main() {
  const token = env().HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    console.error('HUBSPOT_PRIVATE_APP_TOKEN no configurado');
    process.exit(1);
  }

  console.log('--- Account info ---');
  const accountRes = await fetch('https://api.hubapi.com/account-info/v3/details', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!accountRes.ok) {
    console.error('Error:', accountRes.status, await accountRes.text());
    process.exit(1);
  }
  const account = (await accountRes.json()) as {
    portalId: number;
    companyCurrency: string;
    timeZone: string;
    utcOffsetMilliseconds?: number;
  };
  console.log(JSON.stringify(account, null, 2));

  console.log('\n--- Deal pipelines ---');
  const pipeRes = await fetch('https://api.hubapi.com/crm/v3/pipelines/deals', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!pipeRes.ok) {
    console.error('Error:', pipeRes.status, await pipeRes.text());
    process.exit(1);
  }
  const pipes = (await pipeRes.json()) as {
    results: Array<{
      id: string;
      label: string;
      stages: Array<{ id: string; label: string; displayOrder: number }>;
    }>;
  };
  for (const p of pipes.results) {
    console.log(`Pipeline "${p.label}" (id=${p.id}):`);
    for (const s of p.stages.sort((a, b) => a.displayOrder - b.displayOrder)) {
      console.log(`  - ${s.label.padEnd(30)}  id=${s.id}`);
    }
  }

  console.log('\n--- Custom property "venture" en Deals ---');
  const propRes = await fetch('https://api.hubapi.com/crm/v3/properties/deals/venture', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (propRes.status === 404) {
    console.log('NO existe. Hay que crearla.');
  } else if (propRes.ok) {
    const prop = (await propRes.json()) as {
      name: string;
      label: string;
      type: string;
      fieldType: string;
      options?: Array<{ label: string; value: string }>;
    };
    console.log(`Existe. type=${prop.type} fieldType=${prop.fieldType}`);
    if (prop.options) {
      console.log('Options:', prop.options.map((o) => o.value).join(', '));
    }
  } else {
    console.error('Error:', propRes.status, await propRes.text());
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
