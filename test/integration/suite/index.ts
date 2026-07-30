import { activateExtensionTest } from './extension.test';

interface IntegrationTest {
  readonly name: string;
  readonly run: () => Promise<void>;
}

const tests: readonly IntegrationTest[] = [
  {
    name: 'activates in the Extension Host',
    run: activateExtensionTest,
  },
];

export async function run(): Promise<void> {
  const failures: string[] = [];

  for (const integrationTest of tests) {
    try {
      await integrationTest.run();
      process.stdout.write(`PASS ${integrationTest.name}\n`);
    } catch (error) {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      failures.push(`${integrationTest.name}: ${message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join('\n\n'));
  }

  process.stdout.write(
    `Extension Host integration tests passed: ${String(tests.length)}\n`,
  );
}
