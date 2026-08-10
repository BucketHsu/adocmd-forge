import path from 'node:path';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;
const URI_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/iu;

/** 讀取 AsciiDoc 文件中明確宣告的字串屬性；空值會保留為空字串。 */
export function readAsciiDocAttribute(
  source: string,
  attributeName: string,
): string | undefined {
  const escapedName = escapeRegularExpression(attributeName);
  const pattern = new RegExp(
    `^:${escapedName}:(?:[\\t ]*(.*))?$`,
    'imu',
  );
  const match = pattern.exec(source);
  return match === null ? undefined : (match[1] ?? '').trim();
}

/**
 * 解析圖片巨集的相對基準目錄。無 `imagesdir` 時以文件目錄為準；動態屬性、
 * URI 與絕對路徑不臆測，改回安全的文件目錄。
 */
export function resolveAsciiDocImageBaseDirectory(
  source: string,
  sourceFilePath: string,
): string {
  const pathApi = getPathApi(sourceFilePath);
  const documentDirectory = pathApi.dirname(sourceFilePath);
  const imagesDirectory = readAsciiDocAttribute(source, 'imagesdir');
  if (
    imagesDirectory === undefined
    || CONTROL_CHARACTER_PATTERN.test(imagesDirectory)
    || URI_SCHEME_PATTERN.test(imagesDirectory)
    || /[{}]/u.test(imagesDirectory)
    || pathApi.isAbsolute(imagesDirectory)
    || path.win32.isAbsolute(imagesDirectory)
  ) {
    return documentDirectory;
  }
  return pathApi.resolve(documentDirectory, imagesDirectory);
}

/** 建立影像引用交給共用路徑解析器使用的虛擬來源檔案路徑。 */
export function createAsciiDocImageReferenceSourcePath(
  source: string,
  sourceFilePath: string,
): string {
  const pathApi = getPathApi(sourceFilePath);
  return pathApi.join(
    resolveAsciiDocImageBaseDirectory(source, sourceFilePath),
    pathApi.basename(sourceFilePath),
  );
}

function getPathApi(sourceFilePath: string): path.PlatformPath {
  return /^[a-z]:[\\/]/iu.test(sourceFilePath)
    || sourceFilePath.startsWith('\\\\')
    ? path.win32
    : path;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
