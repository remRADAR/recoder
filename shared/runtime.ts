export const EXECUTION_TIMEOUT_MS = 5_000;
export const MAX_OUTPUT_BYTES = 64_000;

export function isSafeProjectPath(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.includes("..") && !path.includes("\\");
}
