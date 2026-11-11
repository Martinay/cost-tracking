import { useEffect, useState, type SetStateAction, type Dispatch } from "react";
function validStructure(value: unknown, initial: unknown): boolean {
  if (typeof value !== typeof initial || value === null) return false;
  if (typeof value !== "object") return true;
  if (!initial || typeof initial !== "object") return false;
  const v = value as Record<string, unknown>;
  if ("mode" in initial) {
    if (v.mode === "Equal")
      return (
        Array.isArray(v.horseIds) &&
        v.horseIds.every((id) => typeof id === "string")
      );
    if (v.mode !== "Custom" || !Array.isArray(v.shares)) return false;
    return v.shares.every(
      (s) =>
        s &&
        typeof s === "object" &&
        typeof s.horseId === "string" &&
        Number.isFinite(s.weight) &&
        s.weight > 0,
    );
  }
  if ("cadence" in initial)
    return (
      ["Daily", "Weekly", "Weekdays", "Monthly"].includes(String(v.cadence)) &&
      Number.isInteger(v.interval) &&
      Number(v.interval) > 0 &&
      Array.isArray(v.weekdays) &&
      v.weekdays.every((d) => Number.isInteger(d) && d >= 1 && d <= 7) &&
      typeof v.startDate === "string" &&
      (v.endDate === null || typeof v.endDate === "string") &&
      (v.dayOfMonth === null ||
        (Number.isInteger(v.dayOfMonth) &&
          Number(v.dayOfMonth) >= 1 &&
          Number(v.dayOfMonth) <= 31))
    );
  return false;
}
function read<T>(key: string | null, initial: T): T {
  if (!key) return initial;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return initial;
    const value: unknown = JSON.parse(raw);
    if (!validStructure(value, initial)) return initial;
    return value as T;
  } catch (e) {
    if (e instanceof DOMException || e instanceof SyntaxError) return initial;
    throw e;
  }
}
export function useDraftState<T>(
  subject: string | null | undefined,
  field: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const key = subject ? `horse-ledger:draft:v1:${subject}:${field}` : null;
  const [state, setState] = useState(() => ({
    key,
    value: read(key, initial),
  }));
  if (state.key !== key) setState({ key, value: read(key, initial) });
  const value = state.key === key ? state.value : initial;
  useEffect(() => {
    if (!key) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      if (!(e instanceof DOMException)) throw e;
      const warn = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = "";
      };
      window.addEventListener("beforeunload", warn);
      return () => window.removeEventListener("beforeunload", warn);
    }
  }, [key, value]);
  return [
    value,
    (next) =>
      setState((prior) => ({
        key,
        value:
          typeof next === "function"
            ? (next as (v: T) => T)(prior.value)
            : next,
      })),
  ];
}

export function clearDraftScope(
  subject: string | null | undefined,
  workflow: string,
): void {
  if (!subject) return;
  const prefix = `horse-ledger:draft:v1:${subject}:${workflow}`;
  try {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith(prefix)) sessionStorage.removeItem(key);
  } catch (e) {
    if (!(e instanceof DOMException)) throw e;
  }
}
