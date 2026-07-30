import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        'dist/**',
        'test/**',
      ],
      provider: 'v8',
      reporter: [
        'text',
        'html',
      ],
      thresholds: {
        branches: 85,
        functions: 95,
        lines: 90,
        statements: 90,
      },
    },
    include: [
      'test/unit/**/*.test.ts',
    ],
  },
});
