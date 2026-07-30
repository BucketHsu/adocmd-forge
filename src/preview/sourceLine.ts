export interface SourceLineMarker {
  readonly sourceLine: number;
}

/**
 * 從依來源行排序的標記中找出距離目標最近者；距離相同時取前一個標記。
 */
export function findClosestSourceMarker<T extends SourceLineMarker>(
  markers: readonly T[],
  sourceLine: number,
): T | undefined {
  if (markers.length === 0) {
    return undefined;
  }

  let lowerBound = 0;
  let upperBound = markers.length;
  while (lowerBound < upperBound) {
    const middle = Math.floor((lowerBound + upperBound) / 2);
    const marker = markers[middle];
    if (marker !== undefined && marker.sourceLine < sourceLine) {
      lowerBound = middle + 1;
    } else {
      upperBound = middle;
    }
  }

  const nextMarker = markers[lowerBound];
  const previousMarker = markers[lowerBound - 1];
  if (nextMarker === undefined) {
    return previousMarker;
  }
  if (previousMarker === undefined) {
    return nextMarker;
  }

  return sourceLine - previousMarker.sourceLine
    <= nextMarker.sourceLine - sourceLine
    ? previousMarker
    : nextMarker;
}
