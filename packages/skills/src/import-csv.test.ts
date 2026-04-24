import { describe, expect, it } from 'vitest';
import { parseCsv } from './import-csv.js';

describe('parseCsv', () => {
  it('parsea CSV simple con headers', () => {
    const raw = 'name,venture\nMatteo,loop\nKaldi,loop';
    const { headers, rows } = parseCsv(raw);
    expect(headers).toEqual(['name', 'venture']);
    expect(rows).toEqual([
      ['Matteo', 'loop'],
      ['Kaldi', 'loop'],
    ]);
  });

  it('respeta comillas y comas embebidas', () => {
    const raw = 'name,address\n"Cafe, Palermo","Santa Fe 1000"';
    const { headers, rows } = parseCsv(raw);
    expect(headers).toEqual(['name', 'address']);
    expect(rows).toEqual([['Cafe, Palermo', 'Santa Fe 1000']]);
  });

  it('maneja comillas dobles escapadas', () => {
    const raw = 'name\n"El ""Cafe"" de Juan"';
    const { rows } = parseCsv(raw);
    expect(rows).toEqual([['El "Cafe" de Juan']]);
  });

  it('maneja newlines embebidos en quoted', () => {
    const raw = 'name,note\n"Cafe","linea 1\nlinea 2"';
    const { rows } = parseCsv(raw);
    expect(rows).toEqual([['Cafe', 'linea 1\nlinea 2']]);
  });

  it('baja headers a lowercase', () => {
    const raw = 'Name,VENTURE\nfoo,loop';
    const { headers } = parseCsv(raw);
    expect(headers).toEqual(['name', 'venture']);
  });

  it('ignora lineas vacias', () => {
    const raw = 'a,b\n\n1,2\n\n3,4\n';
    const { rows } = parseCsv(raw);
    expect(rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('maneja CSV vacio', () => {
    const { headers, rows } = parseCsv('');
    expect(headers).toEqual([]);
    expect(rows).toEqual([]);
  });

  it('funciona con CRLF', () => {
    const raw = 'a,b\r\n1,2\r\n3,4';
    const { rows } = parseCsv(raw);
    expect(rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });
});
