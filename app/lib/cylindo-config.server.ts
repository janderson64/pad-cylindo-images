export type CylindoConfig = {
  accountId: string;
  frame: number;
  size: number;
};

export function parseCylindoFrame(
  value: FormDataEntryValue | string | null | undefined,
): number | undefined {
  const raw =
    value === null || value === undefined ? "" : String(value).trim();

  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

export function getCylindoConfig(overrides?: { frame?: number }): CylindoConfig {
  const accountId = process.env.CYLINDO_ACCOUNT_ID?.trim();

  if (!accountId) {
    throw new Error(
      "CYLINDO_ACCOUNT_ID is required. Set it in your environment (default: 4932 for Paddy O).",
    );
  }

  const defaultFrame = parseInt(process.env.CYLINDO_FRAME ?? "30", 10);

  return {
    accountId,
    frame: overrides?.frame ?? defaultFrame,
    size: parseInt(process.env.CYLINDO_SIZE ?? "1024", 10),
  };
}
