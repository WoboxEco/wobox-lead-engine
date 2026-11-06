import { describe, expect, it } from 'vitest';
import { checkFashionIcp } from './fashion-icp.js';

describe('checkFashionIcp', () => {
  const outOfIcp: Array<[string, string | null, string | null]> = [
    ['Pizzeria Don Luis', 'restaurants', 'pizzeriadonluis.com.ar'],
    ['Deportivo Riestra', null, null],
    ['De Anteojos', null, 'deanteojos.com.ar'],
    ['Evaplas', 'plastics', null],
    ['Descartes', 'environmental services', null],
    ['Tintosur', 'wine & spirits', null],
    ['POSCO', 'mining & metals', null],
    ['Hardfield', 'machinery', null],
  ];
  it.each(outOfIcp)('descarta %s', (name, industry, website_url) => {
    expect(checkFashionIcp({ name, industry, website_url }, 'todos').ok).toBe(false);
  });

  const ideal: Array<[string, string | null]> = [
    ['Key Biscayne', 'apparel & fashion'],
    ['RUMA Zapatos & Carteras', 'footwear'],
    ['Kandil', 'retail apparel and fashion'],
    ['Macowens', null],
    ['Milagros', 'apparel & fashion'],
    ['Amphora', 'fashion accessories'],
  ];
  it.each(ideal)('acepta %s', (name, industry) => {
    expect(
      checkFashionIcp({ name, industry, website_url: 'https://www.marca.com.ar' }, 'todos'),
    ).toEqual({
      ok: true,
    });
  });

  it('término negativo en keywords descarta aunque la industria sea de moda', () => {
    expect(
      checkFashionIcp(
        { name: 'Moda SRL', industry: 'apparel & fashion', keywords: ['reciclado textil'] },
        'todos',
      ).ok,
    ).toBe(false);
  });

  it('muebles solo en muebles_deco', () => {
    const org = { name: 'Casa Living', industry: 'furniture' };
    expect(checkFashionIcp(org, 'todos').ok).toBe(false);
    expect(checkFashionIcp(org, 'muebles_deco').ok).toBe(true);
  });
});
