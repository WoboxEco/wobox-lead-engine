import { env } from '../packages/core/src/index.js';

async function main() {
  const token = env().HUBSPOT_PRIVATE_APP_TOKEN;

  const body = {
    name: 'venture',
    label: 'Venture',
    type: 'enumeration',
    fieldType: 'select',
    groupName: 'dealinformation',
    description: 'Producto de Wobox al que pertenece el deal',
    options: [
      { label: 'Wobox Food', value: 'wobox_food', displayOrder: 0 },
      { label: 'Wobox Fashion', value: 'wobox_fashion', displayOrder: 1 },
      { label: 'Loop', value: 'loop', displayOrder: 2 },
    ],
  };

  const res = await fetch('https://api.hubapi.com/crm/v3/properties/deals', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    console.error('Error:', res.status, JSON.stringify(json, null, 2));
    process.exit(1);
  }
  console.log('Created:', JSON.stringify(json, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
