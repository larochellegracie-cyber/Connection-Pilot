import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/globals.css', 'utf8');

describe('workspace theme stylesheet', () => {
  it('uses the very light blue-grey page background', () => {
    expect(css).toMatch(/--canvas:\s*218 64% 97\.5%;/); // #F4F7FC
  });

  it('has no dark navy page theme left over', () => {
    expect(css).not.toContain('--navy-deep');
    expect(css).not.toContain('.workspace-page :is(main, header)');
  });

  it('defines the cohesive building blocks: card, sections, items, avatar, status dot, hero and banner', () => {
    for (const block of ['.cp-card', '.cp-card-section', '.cp-item', '.cp-avatar', '.cp-dot-lg', '.cp-empty', '.cp-hero', '.cp-kpi-card', '.cp-banner', '.cp-stat', '.cp-navy']) expect(css).toContain(block);
  });

  it('brings back the dark navy and bright blue identity for the header and Pilot’s Briefing', () => {
    expect(css).toMatch(/\.cp-hero \{[^}]*#0B1F44/);
    expect(css).toMatch(/\.cp-navy \{[^}]*background-color: #0B1F44/);
  });

  it('reflows marked tables into cards on phones only', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 767px) {\n  .workspace-page main .cp-stack-table'));
    expect(phone).toContain('.cp-stack-table thead { display: none; }');
    expect(phone).toContain('content: attr(data-label)');
  });
});
