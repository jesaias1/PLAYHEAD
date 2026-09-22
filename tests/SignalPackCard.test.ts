import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const CSS = readFileSync('src/styles/screens.css', 'utf8');
const IMPORT_TS = readFileSync('src/ui/ImportScreen.ts', 'utf8');

function ruleBodies(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g');
  const bodies: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(CSS)) !== null) bodies.push(match[1]);
  return bodies;
}

describe('Signal Pack card — metadata layout', () => {
  it('sizes catalog grid rows to their content (no squash / clip)', () => {
    const bodies = ruleBodies('.showcase-selector-strip');
    const layoutRule = bodies.find(b => b.includes('grid-template-columns'));
    expect(layoutRule, 'showcase-selector-strip layout rule not found').toBeTruthy();
    // Without this the implicit auto rows were squashed to the clamped
    // container height, clipping the metadata row.
    expect(layoutRule!).toMatch(/grid-auto-rows\s*:\s*max-content/);
  });

  it('keeps the BPM/duration metadata in normal flow layout', () => {
    const bodies = [
      ...ruleBodies('.strip-item-meta'),
      ...ruleBodies('.strip-item-bpm,\n.strip-item-meta'),
      ...ruleBodies('.strip-item-bpm, .strip-item-meta')
    ];
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toMatch(/position\s*:\s*absolute/);
      expect(body).not.toMatch(/(^|[;{\s])bottom\s*:/);
    }
    // Metadata is a real flow row inside the card's inner wrapper.
    expect(IMPORT_TS).toContain('strip-item-inner');
    const innerIndex = IMPORT_TS.indexOf('strip-item-inner');
    const metaIndex = IMPORT_TS.indexOf('strip-item-meta');
    expect(innerIndex).toBeGreaterThan(-1);
    expect(metaIndex).toBeGreaterThan(innerIndex);
  });

  it('has no pseudo-element or overlay drawing a line through the card', () => {
    expect(CSS).not.toMatch(/\.strip-item[^{,]*::(before|after)/);
  });

  it('keeps exactly one signal-bar styling path (old duplicate removed)', () => {
    const containerRules = CSS.match(/\.strip-signal-bars\s*\{/g) ?? [];
    const spanRules = CSS.match(/\.strip-signal-bars span\s*\{/g) ?? [];
    expect(containerRules.length).toBe(1);
    expect(spanRules.length).toBe(1);
    // The old combined selector must be gone.
    expect(CSS).not.toMatch(/\.signal-program-bars\s*,\s*\.strip-signal-bars/);
    expect(CSS).not.toMatch(/\.signal-program-bars span\s*,\s*\.strip-signal-bars span/);
  });

  it('uses a single rank/selection border system with no overlapping strokes', () => {
    // Rank styling must only ever style the inline rank badge, never add a
    // border/overlay to the card itself (that would create a second border).
    expect(CSS).not.toMatch(/\.strip-item\.rank-/);
    expect(CSS).not.toMatch(/\.strip-item\s+\.rank-/);

    // Selection styling lives on the card border only.
    const active = ruleBodies('.strip-item.active');
    expect(active.length).toBeGreaterThan(0);
    for (const body of active) {
      expect(body).not.toMatch(/::(before|after)/);
      expect(body).not.toMatch(/border-bottom\s*:/);
    }
  });
});
