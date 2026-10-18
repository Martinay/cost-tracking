import {
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type { ApiResponse } from "../../api/client";

type ApprovalPage = ApiResponse<"/api/v1/income-approvals", "get">;

export function removeDecidedApprovalFromCache(
  queryClient: QueryClient,
  queryKey: QueryKey,
  decision: { ruleId: string; scheduledDate: string },
): void {
  queryClient.setQueryData<InfiniteData<ApprovalPage>>(queryKey, (current) => {
    if (!current) return current;
    return {
      ...current,
      pages: current.pages.map((page) => ({
        ...page,
        items: page.items.filter(
          (item) =>
            item.ruleId !== decision.ruleId ||
            item.scheduledDate !== decision.scheduledDate,
        ),
      })),
    };
  });
}
