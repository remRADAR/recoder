export function canUseLocalExecutionFallback(input: { isProduction: boolean; enabled: boolean; ip: string | undefined; hostname: string | undefined }): boolean {
  if (input.isProduction || !input.enabled) return false;
  const loopback = (value: string | undefined) => value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1" || value === "localhost";
  return loopback(input.ip) && loopback(input.hostname);
}
