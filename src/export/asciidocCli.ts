import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

export interface AsciiDocCliRunOptions {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd: string;
}

export interface AsciiDocCliRunner {
  readonly run: (options: AsciiDocCliRunOptions) => Promise<void>;
}

interface CliInvocation {
  readonly args: readonly string[];
  readonly command: string;
}

interface CliResolutionOptions {
  readonly findCommandPaths?: (
    command: string,
  ) => Promise<readonly string[]>;
  readonly platform?: NodeJS.Platform;
  readonly resolveAbsoluteCommandPaths?: (
    command: string,
  ) => Promise<readonly string[]>;
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

export async function runAsciiDocCli(
  options: AsciiDocCliRunOptions,
): Promise<void> {
  const invocation = await resolveCliInvocation(options.command, options.args);
  return new Promise((resolve, reject) => {
    let stderr = '';
    let childProcess: ReturnType<typeof spawn>;
    try {
      childProcess = spawn(invocation.command, [...invocation.args], {
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
      const detail = 'code' in error && error.code === 'ENOENT'
        ? '找不到命令。請先安裝 asciidoctor-pdf，或在設定 '
          + 'adocmdForge.export.asciidoctorPdfCommand 指定完整路徑。'
        : error.message;
      reject(createCliError(options.command, detail));
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

export async function resolveCliInvocation(
  command: string,
  args: readonly string[],
  options: CliResolutionOptions = {},
): Promise<CliInvocation> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    return { args, command };
  }

  const extension = path.win32.extname(command).toLowerCase();
  if (extension === '.exe' || extension === '.com') {
    return { args, command };
  }

  const findCommandPaths = options.findCommandPaths ?? findWindowsCommandPaths;
  const resolveAbsoluteCommandPaths = options.resolveAbsoluteCommandPaths
    ?? resolveAbsoluteWindowsCommandPaths;
  const commandPaths = path.win32.isAbsolute(command)
    ? await resolveAbsoluteCommandPaths(command)
    : await findCommandPaths(command);
  const rubyPaths = await findCommandPaths('ruby.exe');
  const rubyInvocation = selectWindowsRubyInvocation(
    commandPaths,
    rubyPaths,
  );
  return rubyInvocation === undefined
    ? { args, command }
    : {
        args: [rubyInvocation.scriptPath, ...args],
        command: rubyInvocation.rubyPath,
      };
}

export function selectWindowsRubyInvocation(
  commandPaths: readonly string[],
  rubyPaths: readonly string[],
): { readonly rubyPath: string; readonly scriptPath: string } | undefined {
  for (const commandPath of commandPaths) {
    const extension = path.win32.extname(commandPath).toLowerCase();
    if (extension !== '' && extension !== '.bat' && extension !== '.cmd') {
      continue;
    }
    const scriptPath = extension === ''
      ? commandPath
      : commandPath.slice(0, -extension.length);
    const rubyPath = rubyPaths.find((candidate) => (
      path.win32.dirname(candidate).toLowerCase()
        === path.win32.dirname(scriptPath).toLowerCase()
    ));
    if (rubyPath !== undefined) {
      return { rubyPath, scriptPath };
    }
  }
  return undefined;
}

export async function resolveAbsoluteWindowsCommandPaths(
  command: string,
): Promise<readonly string[]> {
  const extension = path.extname(command).toLowerCase();
  const scriptPath = extension === '.bat' || extension === '.cmd'
    ? command.slice(0, -extension.length)
    : command;
  try {
    await access(scriptPath);
    return [scriptPath, command];
  } catch {
    return [command];
  }
}

export function findWindowsCommandPaths(
  command: string,
): Promise<readonly string[]> {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const childProcess = spawn('where.exe', [command], {
      shell: false,
      windowsHide: true,
    });
    childProcess.stdout.setEncoding('utf8');
    childProcess.stdout.on('data', (chunk: unknown) => {
      if (typeof chunk === 'string') {
        stdout += chunk;
      }
    });
    childProcess.once('error', () => {
      settled = true;
      resolve([]);
    });
    childProcess.once('close', (code: number | null) => {
      if (settled || code !== 0) {
        if (!settled) {
          resolve([]);
        }
        return;
      }
      resolve(stdout
        .split(/\r?\n/u)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0));
    });
  });
}

function createCliError(command: string, detail: string): Error {
  return new Error(
    `Asciidoctor CLI「${command}」執行失敗：${detail}`,
  );
}
