import type { QueryClient, QueryKey } from "@tanstack/react-query";

export type QueryFilters = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;

function normalized(filters: QueryFilters = {}): QueryFilters {
  return Object.fromEntries(
    Object.entries(filters)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function createQueryKeys(subject: string) {
  if (!subject)
    throw new Error("A subject is required for private query keys.");
  return {
    account: ["account", subject] as const,
    horses: (filters: QueryFilters = {}) =>
      ["horses", subject, normalized(filters)] as const,
    horse: (horseId: string) => ["horse", subject, horseId] as const,
    expenses: (
      range: { from: string; to: string },
      filters: QueryFilters = {},
    ) =>
      ["expenses", subject, range.from, range.to, normalized(filters)] as const,
    expenseRules: ["expenseRules", subject] as const,
    income: (range: { from: string; to: string }, filters: QueryFilters = {}) =>
      ["income", subject, range.from, range.to, normalized(filters)] as const,
    incomeRules: ["incomeRules", subject] as const,
    approvals: (through: string, filters: QueryFilters = {}) =>
      ["approvals", subject, through, normalized(filters)] as const,
    tasks: (filters: QueryFilters = {}) =>
      ["tasks", subject, normalized(filters)] as const,
    report: (kind: string, parameters: QueryFilters = {}) =>
      ["report", subject, kind, normalized(parameters)] as const,
    history: (filters: QueryFilters = {}) =>
      ["history", subject, normalized(filters)] as const,
  };
}

export interface SubjectQueryLifecycle {
  readonly subject: string | null;
  setSubject(subject: string | null): Promise<void>;
}

export function createSubjectQueryLifecycle(
  queryClient: QueryClient,
  setApiSubject?: (subject: string | null) => Promise<void>,
): SubjectQueryLifecycle {
  let subject: string | null = null;
  return {
    get subject() {
      return subject;
    },
    async setSubject(nextSubject) {
      if (subject === nextSubject) return;
      await queryClient.cancelQueries();
      try {
        await setApiSubject?.(nextSubject);
      } finally {
        queryClient.clear();
        subject = nextSubject;
      }
    },
  };
}

export function invalidateSubjectLists(
  queryClient: QueryClient,
  subject: string,
  resource: string,
): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: ({ queryKey }) =>
      isSubjectResourceKey(queryKey, resource, subject),
  });
}

function isSubjectResourceKey(
  queryKey: QueryKey,
  resource: string,
  subject: string,
): boolean {
  return queryKey[0] === resource && queryKey[1] === subject;
}
