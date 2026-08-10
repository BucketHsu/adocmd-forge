import path from 'node:path';

const DEFAULT_CANDIDATE_LIMIT = 5;

/**
 * 依使用者目前輸入排序工作區路徑或 Anchor 候選。完全相同的值不列入，
 * 避免 Quick Fix 提供不會改變文件的操作。
 */
export function rankQuickFixCandidates(
  candidates: readonly string[],
  query: string,
  limit = DEFAULT_CANDIDATE_LIMIT,
): readonly string[] {
  const normalizedQuery = normalizeCandidate(query);
  const uniqueCandidates = [...new Set(candidates)].filter((candidate) => (
    normalizeCandidate(candidate) !== normalizedQuery
  ));

  return uniqueCandidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, query),
    }))
    .sort((left, right) => (
      left.score - right.score
      || left.candidate.localeCompare(right.candidate, 'en', {
        numeric: true,
        sensitivity: 'base',
      })
    ))
    .slice(0, normalizeLimit(limit))
    .map(({ candidate }) => candidate);
}

/** 以新的相對路徑取代引用，保留原本的 query 與 fragment。 */
export function replaceReferencePath(
  target: string,
  replacementPath: string,
): string {
  const suffixIndexes = [target.indexOf('?'), target.indexOf('#')]
    .filter((index) => index >= 0);
  const suffixIndex = suffixIndexes.length === 0
    ? target.length
    : Math.min(...suffixIndexes);
  return `${replacementPath}${target.slice(suffixIndex)}`;
}

function scoreCandidate(candidate: string, query: string): number {
  const normalizedCandidate = normalizeCandidate(candidate);
  const normalizedQuery = normalizeCandidate(query);
  const candidateName = path.posix.basename(normalizedCandidate);
  const queryName = path.posix.basename(normalizedQuery);

  if (normalizedCandidate.startsWith(normalizedQuery)) {
    return normalizedCandidate.length - normalizedQuery.length;
  }
  if (candidateName.startsWith(queryName)) {
    return 20 + candidateName.length - queryName.length;
  }
  if (normalizedCandidate.includes(normalizedQuery)) {
    return 40 + normalizedCandidate.indexOf(normalizedQuery);
  }
  if (candidateName.includes(queryName)) {
    return 60 + candidateName.indexOf(queryName);
  }
  return 100 + levenshteinDistance(normalizedCandidate, normalizedQuery);
}

function normalizeCandidate(value: string): string {
  return value
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .toLocaleLowerCase();
}

function normalizeLimit(limit: number): number {
  return Number.isSafeInteger(limit) && limit > 0
    ? limit
    : DEFAULT_CANDIDATE_LIMIT;
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const insertion = (current[rightIndex - 1] ?? 0) + 1;
      const deletion = (previous[rightIndex] ?? 0) + 1;
      const substitution = (previous[rightIndex - 1] ?? 0)
        + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current.push(Math.min(insertion, deletion, substitution));
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? 0;
}
