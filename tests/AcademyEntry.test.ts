import { describe, expect, it } from 'vitest';
import { resolveAcademyEntry } from '../src/lab/AcademyEntry';
import { createProgress, ACADEMY_LESSON_ORDER } from '../src/lab/MovementAcademyProgress';

describe('READY Academy entry', () => {
  it('offers basics to fresh players and the surf lesson for surf worlds', () => {
    const progress = createProgress();
    expect(resolveAcademyEntry({ progress, variant: 'NORMAL' }).visible).toBe(true);
    expect(resolveAcademyEntry({ progress, variant: 'SURF' }).label).toContain('SURF BASICS');
  });
  it('requires completion evidence for every lesson, not skipped lessons', () => {
    const progress = createProgress();
    for (const lesson of ACADEMY_LESSON_ORDER) progress.lessons[lesson] = 'COMPLETE';
    expect(resolveAcademyEntry({ progress, variant: 'NORMAL' }).visible).toBe(false);
    progress.lessons.SURF = 'SKIPPED';
    expect(resolveAcademyEntry({ progress, variant: 'NORMAL' }).visible).toBe(true);
  });
});
