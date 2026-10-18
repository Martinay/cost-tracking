import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ApiResponse } from "../../src/api/client";
import { removeDecidedApprovalFromCache } from "../../src/features/approvals/approvalCache";

type ApprovalPage = ApiResponse<"/api/v1/income-approvals", "get">;

describe("removeDecidedApprovalFromCache", () => {
  it("removes the committed decision from every cached page by occurrence identity", () => {
    const queryClient = new QueryClient();
    const queryKey = [
      "approvals",
      "owner-a",
      "2026-09-21",
      { from: "2026-09-01" },
    ];
    const page = (scheduledDate: string): ApprovalPage => ({
      items: [
        {
          ruleId: "rule-a",
          scheduledDate,
          amountMinor: 10000,
          source: "Lesson",
          splitMode: "Equal",
          allocations: [
            { horseId: "horse-a", weight: 1000000, amountMinor: 10000 },
          ],
        },
        {
          ruleId: "rule-b",
          scheduledDate: "2026-09-21",
          amountMinor: 20000,
          source: "Boarding",
          splitMode: "Equal",
          allocations: [
            { horseId: "horse-b", weight: 1000000, amountMinor: 20000 },
          ],
        },
      ],
      nextCursor: null,
      from: "2026-09-01",
      through: "2026-09-21",
      asOfDate: "2026-09-21",
      streamVersion: 8,
    });
    const data: InfiniteData<ApprovalPage> = {
      pages: [page("2026-09-20"), page("2026-09-21")],
      pageParams: [null, "cursor"],
    };
    queryClient.setQueryData(queryKey, data);

    removeDecidedApprovalFromCache(queryClient, queryKey, {
      ruleId: "rule-a",
      scheduledDate: "2026-09-21",
    });

    const updated =
      queryClient.getQueryData<InfiniteData<ApprovalPage>>(queryKey);
    expect(
      updated?.pages.map((entry) =>
        entry.items.map((item) => [item.ruleId, item.scheduledDate]),
      ),
    ).toEqual([
      [
        ["rule-a", "2026-09-20"],
        ["rule-b", "2026-09-21"],
      ],
      [["rule-b", "2026-09-21"]],
    ]);
    expect(updated?.pageParams).toEqual([null, "cursor"]);
  });
});
