import type { components } from "../../api/schema";

export type TaskType = components["schemas"]["TaskType"];
export const TASK_TYPES = [
  "Riding",
  "Groundwork",
  "Lunging",
  "Grooming",
  "MedicalCare",
  "PaddockDuty",
  "Transportation",
  "Other",
] as const satisfies readonly TaskType[];
export function taskTypeLabel(type: TaskType): string {
  return type.replace(/([a-z])([A-Z])/g, "$1 $2");
}
