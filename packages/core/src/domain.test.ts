import { describe, expect, it } from 'vitest';
import { isWoboxVenture, scoringModelForVenture, stageForScore } from './domain.js';

describe('isWoboxVenture', () => {
  it('identifica ventures wobox', () => {
    expect(isWoboxVenture('wobox_food')).toBe(true);
    expect(isWoboxVenture('wobox_fashion')).toBe(true);
  });

  it('loop no es wobox', () => {
    expect(isWoboxVenture('loop')).toBe(false);
  });
});

describe('scoringModelForVenture', () => {
  it('devuelve scoring-wobox-v1 para ventures wobox', () => {
    expect(scoringModelForVenture('wobox_food')).toBe('scoring-wobox-v1');
    expect(scoringModelForVenture('wobox_fashion')).toBe('scoring-wobox-v1');
  });

  it('devuelve scoring-loop-v1 para loop', () => {
    expect(scoringModelForVenture('loop')).toBe('scoring-loop-v1');
  });
});

describe('stageForScore', () => {
  it('>= 80 -> qualified', () => {
    expect(stageForScore(80)).toBe('qualified');
    expect(stageForScore(95)).toBe('qualified');
    expect(stageForScore(100)).toBe('qualified');
  });

  it('50-79 -> qualified', () => {
    expect(stageForScore(50)).toBe('qualified');
    expect(stageForScore(75)).toBe('qualified');
    expect(stageForScore(79)).toBe('qualified');
  });

  it('< 50 -> discarded', () => {
    expect(stageForScore(49)).toBe('discarded');
    expect(stageForScore(0)).toBe('discarded');
    expect(stageForScore(30)).toBe('discarded');
  });
});
