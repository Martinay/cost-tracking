export type IconName =
  | "horses"
  | "expenses"
  | "income"
  | "approvals"
  | "tasks"
  | "reports"
  | "settings"
  | "arrow"
  | "logout";

const paths: Record<Exclude<IconName, "horses">, string> = {
  expenses: "M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4",
  income: "M12 16V4m-4 4 4-4 4 4M5 16v4h14v-4",
  approvals: "M9 4H5v17h14V4h-4M9 3h6v4H9zM8 14l3 3 5-6",
  tasks: "M9 6h11M9 12h11M9 18h11M3 6l1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2",
  reports: "M4 3v17h17M8 16v-5m5 5V7m5 9V4",
  settings:
    "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  logout: "M9 4H4v16h5M9 12h12m-5-5 5 5-5 5",
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "horses" ? (
        <use href="/horse-head.svg#horse-head" />
      ) : (
        <path d={paths[name]} />
      )}
    </svg>
  );
}
