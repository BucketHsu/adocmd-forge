export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  try {
    return String(error);
  } catch {
    return 'Unknown error.';
  }
}
