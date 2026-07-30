import { sync as globSync } from 'glob';
import { describe, expect, it } from 'vitest';

import createAsciidoctorRuntime from '../../../src/renderer/asciidoctorRuntime.cjs';

describe('Asciidoctor CommonJS runtime adapter', (): void => {
  it('loads @asciidoctor/core 3.0.4 through its CommonJS entry', (): void => {
    const asciidoctor = createAsciidoctorRuntime();

    expect(asciidoctor.getVersion()).toBe('3.0.4');
    expect(asciidoctor.convert('CJS *runtime*.', {
      header_footer: false,
      safe: 'safe',
    })).toContain('<strong>runtime</strong>');
  });

  it('retains the synchronous glob API required by the Opal runtime', (): void => {
    expect(typeof globSync).toBe('function');
  });
});
