export type CylindoConfig = {
  accountId: string;
  frame: number;
  size: number;
  version: number;
};

export function getCylindoConfig(): CylindoConfig {
  const accountId = process.env.CYLINDO_ACCOUNT_ID?.trim();

  if (!accountId) {
    throw new Error(
      "CYLINDO_ACCOUNT_ID is required. Set it in your environment (default: 4932 for Paddy O).",
    );
  }

  return {
    accountId,
    frame: parseInt(process.env.CYLINDO_FRAME ?? "30", 10),
    size: parseInt(process.env.CYLINDO_SIZE ?? "1024", 10),
    version: parseInt(process.env.CYLINDO_VERSION ?? "5", 10),
  };
}
