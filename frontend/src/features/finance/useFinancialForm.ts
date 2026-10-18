import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  type ApiCommand,
  type ApiExpenseBody,
  type ApiIncomeBody,
  type ApiResponse,
} from "../../api/client";
import { createQueryKeys } from "../../api/queryKeys";
import { useAuthServices } from "../../auth/AuthBoundary";

export type SplitValue =
  | { mode: "Equal"; horseIds: string[] }
  | { mode: "Custom"; shares: { horseId: string; weight: number }[] };
export type FinancialHorse = Pick<
  ApiResponse<"/api/v1/horses", "get">["items"][number],
  "horseId" | "name" | "status"
>;
export type FinancialAccount = ApiResponse<"/api/v1/account", "get">;
export type FinancialPreview = ApiResponse<
  "/api/v1/previews/financial",
  "post"
>;
export type FinanceKind = "Expense" | "Income";
export type FinanceBody = ApiExpenseBody | ApiIncomeBody;
function message(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "This request could not be completed. Please try again.";
}
function today(account?: FinancialAccount): string {
  return account?.ownerToday ?? new Date().toISOString().slice(0, 10);
}

export function useFinancialForm(kind: FinanceKind) {
  const { apiClient, canLoadProtectedData, subject } = useAuthServices();
  const queryClient = useQueryClient();
  const keys = subject ? createQueryKeys(subject) : null;
  const account = useQuery({
    queryKey: keys?.account ?? ["account", "unavailable"],
    enabled: canLoadProtectedData && subject !== null,
    queryFn: async () => {
      const result = await apiClient.get({
        subject: subject!,
        path: "/api/v1/account",
      });
      apiClient.rememberVersion(subject!, result.streamVersion);
      return result;
    },
  });
  const horses = useQuery({
    queryKey: keys?.horses() ?? ["horses", "unavailable"],
    enabled: canLoadProtectedData && subject !== null,
    queryFn: async () =>
      await apiClient.get({
        subject: subject!,
        path: "/api/v1/horses",
      }),
  });
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [detail, setDetail] = useState("");
  const [description, setDescription] = useState("");
  const [split, setSplit] = useState<SplitValue>({
    mode: "Equal",
    horseIds: [],
  });
  const horseIds =
    split.mode === "Equal"
      ? split.horseIds
      : split.shares.map((share) => share.horseId);
  const [preview, setPreview] = useState<FinancialPreview | null>(null);
  const [previewFingerprint, setPreviewFingerprint] = useState("");
  const [notice, setNotice] = useState("");
  const pendingCommand = useRef<ApiCommand | null>(null);
  const formDate = date || today(account.data);
  const minor = parseAmount(amount);
  const values: FinanceBody | null =
    kind === "Expense"
      ? detail.trim()
        ? {
            expenseDate: formDate,
            amountMinor: minor ?? 0,
            category: detail,
            description: description.trim(),
            split,
          }
        : null
      : detail.trim()
        ? {
            receivedDate: formDate,
            amountMinor: minor ?? 0,
            source: detail.trim(),
            split,
          }
        : null;
  const fingerprint = values ? JSON.stringify(values) : "";
  const currentPreview =
    preview && fingerprint === previewFingerprint ? preview : null;
  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!subject || !values || !minor || minor <= 0 || horseIds.length === 0)
        throw new Error("Complete the form first.");
      return await apiClient.preview({
        subject,
        path: "/api/v1/previews/financial",
        body: { kind, values },
      });
    },
    onSuccess: (result) => {
      setPreview(result);
      setPreviewFingerprint(fingerprint);
      if (subject) apiClient.rememberVersion(subject, result.streamVersion);
    },
  });
  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!subject || !values || !currentPreview)
        throw new Error("Preview this exact entry before saving.");
      const path = kind === "Expense" ? "/api/v1/expenses" : "/api/v1/income";
      let command = pendingCommand.current;
      if (
        !command ||
        command.subject !== subject ||
        command.path !== path ||
        command.body !== JSON.stringify(values) ||
        command.streamVersion !== currentPreview.streamVersion
      ) {
        command = apiClient.createCommand({
          subject,
          method: "POST",
          path,
          body: values,
          streamVersion: currentPreview.streamVersion,
        });
        pendingCommand.current = command;
      }
      return await apiClient.sendCommand(command);
    },
    onSuccess: async (result) => {
      pendingCommand.current = null;
      setNotice(kind === "Expense" ? "Expense saved." : "Income saved.");
      if (
        subject &&
        typeof result === "object" &&
        result &&
        "streamVersion" in result &&
        typeof result.streamVersion === "number"
      ) {
        apiClient.rememberVersion(subject, result.streamVersion);
        await Promise.all(
          ["expenses", "income", "account", "history", "report"].map(
            (resource) =>
              queryClient.invalidateQueries({
                predicate: (query) =>
                  query.queryKey[0] === resource &&
                  query.queryKey[1] === subject,
              }),
          ),
        );
      }
      setPreview(null);
      setPreviewFingerprint("");
      setDate("");
      setAmount("");
      setDetail("");
      setDescription("");
      setSplit({ mode: "Equal", horseIds: [] });
    },
    onError: (error) => {
      if (
        error instanceof ApiError &&
        (error.status === 409 || error.status === 412)
      ) {
        setPreview(null);
        setPreviewFingerprint("");
      }
    },
  });
  const allHorses = horses.data?.items ?? [];
  const activeHorses = allHorses.filter(
    (horse) => horse.status === "Active" || horse.status === "Leased",
  );
  const error =
    previewMutation.error ??
    commitMutation.error ??
    account.error ??
    horses.error;
  return {
    kind,
    date: formDate,
    setDate,
    amount,
    setAmount,
    detail,
    setDetail,
    description,
    setDescription,
    horseIds,
    split,
    setSplit,
    activeHorses,
    allHorses,
    currency: account.data?.currency ?? "EUR",
    ready:
      canLoadProtectedData &&
      account.data !== undefined &&
      horses.data !== undefined,
    loading: account.isPending || horses.isPending,
    preview: currentPreview,
    previewing: previewMutation.isPending,
    saving: commitMutation.isPending,
    notice,
    errorMessage: error ? message(error) : "",
    canPreview: Boolean(
      values &&
      minor &&
      minor > 0 &&
      horseIds.length > 0 &&
      !previewMutation.isPending,
    ),
    canSave: Boolean(currentPreview && !commitMutation.isPending),
    previewNow: () => {
      setNotice("");
      setPreview(null);
      void previewMutation.mutateAsync().catch(() => undefined);
    },
    save: () => {
      setNotice("");
      void commitMutation.mutateAsync().catch(() => undefined);
    },
    errorFor: (field: string) =>
      error instanceof ApiError
        ? error.details?.find((item) => item.field === field)?.message
        : undefined,
  };
}

function parseAmount(input: string): number | null {
  if (!/^\d+(?:[.,]\d{0,2})?$/.test(input.trim())) return null;
  const [whole, fraction = ""] = input.trim().replace(",", ".").split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) ? amount : null;
}
