import { spawn } from 'node:child_process';

export interface AsciiDocCliRunOptions {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd: string;
}

export interface AsciiDocCliRunner {
  readonly run: (options: AsciiDocCliRunOptions) => Promise<void>;
}

/**
 * 展開外部 Asciidoctor CLI 的參數佔位符。
 *
 * `{source}`、`{destination}` 與 `{workspace}` 由擴充套件填入；若使用者
 * 未提供 source 或 destination，會以標準 `-o destination source` 補上。
 */
export function buildAsciiDocCliArguments(
  configuredArguments: readonly string[],
  sourcePath: string,
  destinationPath: string,
  workspacePath: string,
): readonly string[] {
  const replacements: Readonly<Record<string, string>> = {
    '{destination}': destinationPath,
    '{source}': sourcePath,
    '{workspace}': workspacePath,
  };
  const args = configuredArguments.map((argument) => (
    Object.entries(replacements).reduce(
      (value, [placeholder, replacement]) => value.replaceAll(placeholder, replacement),
      argument,
    )
  ));
  const sourceConfigured = configuredArguments.some((argument) => (
    argument.includes('{source}')
  ));
  const destinationConfigured = configuredArguments.some((argument) => (
    argument.includes('{destination}')
  ));

  return [
    ...args,
    ...(destinationConfigured ? [] : ['-o', destinationPath]),
    ...(sourceConfigured ? [] : [sourcePath]),
  ];
}

export const defaultAsciiDocCliRunner: AsciiDocCliRunner = {
  run: runAsciiDocCli,
};

export function runAsciiDocCli(
  options: AsciiDocCliRunOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let childProcess: ReturnType<typeof spawn>;
    try {
      childProcess = spawn(options.command, [...options.args], {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    childProcess.stderr?.setEncoding('utf8');
    childProcess.stderr?.on('data', (chunk: unknown) => {
      if (typeof chunk === 'string') {
        stderr += chunk;
      }
    });
    childProcess.once('error', (error: Error) => {
      reject(createCliError(options.command, error.message));
    });
    childProcess.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) {
        resolve();
        return;
      }

      const detail = stderr.trim();
      reject(createCliError(
        options.command,
        detail.length > 0
          ? detail
          : `process exited with ${signal ?? `code ${String(code)}`}`,
      ));
    });
  });
}

function createCliError(command: string, detail: string): Error {
  return new Error(
    `Asciidoctor CLI「${command}」執行失敗：${detail}`,
  );
}
