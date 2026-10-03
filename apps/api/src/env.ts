// Reads a setting that the stack gives a Lambda (S2-09). Throws when the module loads, so a
// misconfigured function fails its first request loudly, instead of running with a blank value.
export const requiredEnv = (
  name: string,
  env: Record<string, string | undefined> = process.env,
): string => {
  const value = env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
};
