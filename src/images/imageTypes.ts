export type ImageDocumentKind = 'asciidoc' | 'markdown';

export interface ImageSource {
  readonly name: string;
  readonly mimeType?: string;
  readonly data: Uint8Array;
}

export interface ImageDocumentContext {
  readonly documentPath?: string | undefined;
  readonly workspaceRootPath?: string | undefined;
  readonly language: ImageDocumentKind;
  readonly isTrusted: boolean;
}

export interface ImageServiceSettings {
  readonly directory: string;
  readonly promptForPath: boolean;
  readonly defaultAltText: string;
}

export interface ImageFileSystem {
  exists(path: string): Promise<boolean>;
  createDirectory(path: string): Promise<void>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  deleteFile(path: string): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
}

export interface ImageTargetPicker {
  pick(defaultPath: string, suggestedName: string): Promise<string | undefined>;
}

export interface ImageOperation {
  readonly targetPath: string;
  readonly fileName: string;
  readonly relativePath: string;
  readonly altText: string;
  readonly syntax: string;
  readonly data: Uint8Array;
}
