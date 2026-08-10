export interface InlineMarkup {
  readonly close: string;
  readonly open: string;
}

export interface TextSelectionOffsets {
  readonly end: number;
  readonly start: number;
}

export interface FormattedText {
  readonly selections: readonly TextSelectionOffsets[];
  readonly text: string;
}

/**
 * 將標記套用到多個文字選取範圍。
 *
 * 這個純函式不依賴 VS Code，可在單元測試驗證多游標、空選取與重疊
 * 選取。重疊範圍只套用第一個範圍，避免產生難以預期的巢狀標記。
 */
export function wrapTextSelections(
  source: string,
  selections: readonly TextSelectionOffsets[],
  markup: InlineMarkup,
): FormattedText {
  const normalized = selections.map((selection, index) => ({
    end: Math.max(selection.start, selection.end),
    index,
    start: Math.min(selection.start, selection.end),
  }));
  const sorted = [...normalized].sort((left, right) => (
    left.start - right.start
    || left.end - right.end
    || left.index - right.index
  ));

  const accepted = [] as typeof normalized;
  let occupiedUntil = -1;
  for (const selection of sorted) {
    const previous = accepted.at(-1);
    if (
      selection.start < 0
      || selection.end > source.length
      || selection.start > selection.end
      || selection.start < occupiedUntil
      || (
        previous?.start === selection.start
        && previous.end === selection.end
      )
    ) {
      continue;
    }
    accepted.push(selection);
    occupiedUntil = selection.end;
  }

  let cursor = 0;
  const chunks: string[] = [];
  for (const selection of accepted) {
    chunks.push(
      source.slice(cursor, selection.start),
      markup.open,
      source.slice(selection.start, selection.end),
      markup.close,
    );
    cursor = selection.end;
  }
  chunks.push(source.slice(cursor));

  const acceptedIndexes = new Set(accepted.map(({ index }) => index));
  const transformedSelections = normalized.map((selection) => {
    if (acceptedIndexes.has(selection.index)) {
      const deltaBefore = accepted.reduce(
        (total, acceptedSelection) => (
          acceptedSelection.index !== selection.index
          && acceptedSelection.end <= selection.start
            ? total + markup.open.length + markup.close.length
            : total
        ),
        0,
      );
      return {
        end: selection.end + deltaBefore + markup.open.length,
        start: selection.start + deltaBefore + markup.open.length,
      };
    }

    return {
      end: mapOffset(selection.end, accepted, markup),
      start: mapOffset(selection.start, accepted, markup),
    };
  });

  return {
    selections: transformedSelections,
    text: chunks.join(''),
  };
}

function mapOffset(
  offset: number,
  edits: readonly TextSelectionOffsets[],
  markup: InlineMarkup,
): number {
  let mappedOffset = offset;
  for (const edit of edits) {
    if (edit.end <= offset) {
      mappedOffset += markup.open.length + markup.close.length;
    } else if (edit.start < offset) {
      mappedOffset += markup.open.length;
      break;
    }
  }
  return mappedOffset;
}
