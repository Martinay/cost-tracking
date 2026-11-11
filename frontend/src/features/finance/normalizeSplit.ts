import type { SplitValue } from "./useFinancialForm";

export function normalizeSplit(value: SplitValue): SplitValue {
  if (value.mode === "Equal") return value;
  const shares = value.shares;
  if (
    !shares.length ||
    shares.length > 1_000_000 ||
    shares.some(
      (s) =>
        !Number.isFinite(s.weight) ||
        s.weight <= 0 ||
        !/^\d+(?:\.\d{1,6})?$/.test(String(s.weight)),
    )
  )
    throw new Error(
      "Enter positive split shares with up to six decimal places, for example 2 and 1.",
    );
  function scaled(weight: number): bigint {
    const [whole, fraction = ""] = String(weight).split(".");
    return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  }
  const total = shares.reduce((sum, s) => sum + scaled(s.weight), 0n);
  const parts = shares.map((s) => ({
    ...s,
    weight: Number((scaled(s.weight) * 1_000_000n) / total),
    remainder: (scaled(s.weight) * 1_000_000n) % total,
  }));
  const remaining = 1_000_000 - parts.reduce((sum, s) => sum + s.weight, 0);
  const order = [...parts].sort((a, b) =>
    a.remainder === b.remainder
      ? a.horseId < b.horseId
        ? -1
        : 1
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (let i = 0; i < remaining; i++) order[i].weight++;
  if (parts.some((s) => s.weight === 0))
    throw new Error(
      "These ratios are too different. Use smaller whole-number ratios.",
    );
  return {
    mode: "Custom",
    shares: parts.map(({ horseId, weight }) => ({ horseId, weight })),
  };
}

export function splitJsonReplacer(key: string, value: unknown): unknown {
  if (key === "split" && value && typeof value === "object" && "mode" in value)
    return normalizeSplit(value as SplitValue);
  return value;
}

export function editorShares(
  allocations: readonly { horseId: string; weight: number }[],
): { horseId: string; weight: number }[] {
  return allocations.map((a) => ({
    horseId: a.horseId,
    weight: Number((a.weight / 10000).toFixed(4)),
  }));
}
