import path from 'node:path';

import {
  getExtension,
  inferImageExtension,
  isPathWithinRoot,
  resolveDefaultImagePath,
  resolveSelectedImagePath,
  sanitizeImageFileName,
  ImagePathPolicyError,
} from './imagePathPolicy';
import { buildImageSyntax } from './imageSyntaxBuilder';
import type {
  ImageDocumentContext,
  ImageFileSystem,
  ImageOperation,
  ImageServiceSettings,
  ImageSource,
  ImageTargetPicker,
} from './imageTypes';

export class ImageWorkflowError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ImageWorkflowError';
  }
}

export class ImageService {
  public constructor(
    private readonly fileSystem: ImageFileSystem,
    private readonly targetPicker: ImageTargetPicker,
    private readonly settings: ImageServiceSettings,
  ) {}

  public async prepare(
    context: ImageDocumentContext,
    source: ImageSource,
  ): Promise<ImageOperation | undefined> {
    this.validateContext(context);

    let extension: string;
    let fileName: string;
    try {
      extension = inferImageExtension(source.name, source.mimeType);
      fileName = sanitizeImageFileName(source.name, source.mimeType);
    } catch (error) {
      throw toWorkflowError(error);
    }

    const defaultPlan = resolveDefaultImagePath(
      context.documentPath,
      context.workspaceRootPath,
      this.settings.directory,
      fileName,
    );
    const suggestedPath = await this.findAvailablePath(defaultPlan.targetPath);
    const selectedPath = this.settings.promptForPath
      ? await this.targetPicker.pick(suggestedPath, fileName)
      : suggestedPath;

    if (selectedPath === undefined) {
      return undefined;
    }

    let selectedPlan: { readonly targetPath: string; readonly relativePath: string };
    try {
      selectedPlan = resolveSelectedImagePath(
        context.documentPath,
        context.workspaceRootPath,
        selectedPath,
        extension,
      );
    } catch (error) {
      throw toWorkflowError(error);
    }

    if (!isPathWithinRoot(
      selectedPlan.targetPath,
      context.workspaceRootPath,
    )) {
      throw new ImageWorkflowError('圖片儲存位置必須位於目前工作區資料夾內。');
    }

    const targetPath = await this.findAvailablePath(selectedPlan.targetPath);
    const relativePath = targetPath === selectedPlan.targetPath
      ? selectedPlan.relativePath
      : this.relativePath(context.documentPath, targetPath);
    const targetFileName = path.posix.basename(targetPath);
    const altText = this.getAltText(this.settings.defaultAltText, targetFileName);

    return {
      targetPath,
      fileName: targetFileName,
      relativePath,
      altText,
      syntax: buildImageSyntax(context.language, relativePath, altText),
      data: source.data,
    };
  }

  public async save(operation: ImageOperation): Promise<void> {
    const directory = path.posix.dirname(operation.targetPath);
    await this.fileSystem.createDirectory(directory);
    if (await this.fileSystem.exists(operation.targetPath)) {
      throw new ImageWorkflowError('圖片檔案已存在，為避免覆蓋而取消儲存。');
    }

    await this.fileSystem.writeFile(operation.targetPath, operation.data);
  }

  public async remove(operation: ImageOperation): Promise<void> {
    if (await this.fileSystem.exists(operation.targetPath)) {
      await this.fileSystem.deleteFile(operation.targetPath);
    }
  }

  public async readSource(
    context: ImageDocumentContext,
    sourcePath: string,
  ): Promise<ImageSource> {
    this.validateContext(context);
    const data = await this.fileSystem.readFile(sourcePath);
    const fileName = path.posix.basename(sourcePath);
    return {
      name: fileName,
      data,
    };
  }

  private validateContext(
    context: ImageDocumentContext,
  ): asserts context is ImageDocumentContext & {
    readonly documentPath: string;
    readonly workspaceRootPath: string;
  } {
    if (!context.isTrusted) {
      throw new ImageWorkflowError('圖片寫入功能需要受信任的工作區。');
    }

    if (context.documentPath === undefined) {
      throw new ImageWorkflowError('請先儲存文件，再插入圖片。');
    }

    if (context.workspaceRootPath === undefined) {
      throw new ImageWorkflowError('圖片插入需要目前文件位於工作區資料夾內。');
    }

    if (!isPathWithinRoot(context.documentPath, context.workspaceRootPath)) {
      throw new ImageWorkflowError('目前文件不在允許的工作區資料夾內。');
    }
  }

  private async findAvailablePath(candidatePath: string): Promise<string> {
    if (!(await this.fileSystem.exists(candidatePath))) {
      return candidatePath;
    }

    const extension = getExtension(candidatePath) ?? '';
    const baseName = path.posix.basename(candidatePath, extension);
    const directory = path.posix.dirname(candidatePath);
    for (let suffix = 2; suffix <= 10_000; suffix += 1) {
      const alternative = path.posix.join(
        directory,
        `${baseName}-${String(suffix)}${extension}`,
      );
      if (!(await this.fileSystem.exists(alternative))) {
        return alternative;
      }
    }

    throw new ImageWorkflowError('無法為圖片產生不重複的檔名。');
  }

  private relativePath(documentPath: string, targetPath: string): string {
    const documentDirectory = path.posix.dirname(documentPath);
    const relative = path.posix.relative(documentDirectory, targetPath);
    return relative.length > 0 ? relative : path.posix.basename(targetPath);
  }

  private getAltText(setting: string, fileName: string): string {
    const configured = setting.trim();
    if (configured.length > 0 && configured.toLowerCase() !== 'filename') {
      return configured;
    }

    const extension = getExtension(fileName) ?? '';
    return path.posix.basename(fileName, extension);
  }
}

function toWorkflowError(error: unknown): ImageWorkflowError {
  if (error instanceof ImageWorkflowError) {
    return error;
  }

  if (error instanceof ImagePathPolicyError) {
    return new ImageWorkflowError(error.message);
  }

  return new ImageWorkflowError(
    error instanceof Error ? error.message : '圖片處理失敗。',
  );
}
