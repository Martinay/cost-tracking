import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Modal } from "../../components/Modal";
import { useAuthServices } from "../../auth/AuthBoundary";
import { useI18n } from "../../i18n/I18nProvider";
import {
  TaskForm,
  type TaskCommandBody,
  type TaskHorseOption,
} from "./TaskForm";
import type { ApiCommand } from "../../api/client";
export function TaskCorrection({
  item,
  horses,
  today,
}: {
  item: TaskCommandBody & { taskId: string };
  horses: TaskHorseOption[];
  today: string;
}) {
  const { t } = useI18n();
  const { subject, apiClient } = useAuthServices();
  const queries = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const command = useRef<ApiCommand | null>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        {t("Correct task")}
      </button>
      {open && (
        <Modal
          labelledBy="task-correction-heading"
          onClose={() => setOpen(false)}
        >
          <h2 id="task-correction-heading">{t("Correct task")}</h2>
          <p>
            {t(
              "The original entry stays in history. Explain the correction before saving.",
            )}
          </p>
          <label>
            {t("Reason for correction")}
            <input
              required
              maxLength={500}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                command.current = null;
              }}
            />
          </label>
          <TaskForm
            initial={item}
            horses={horses}
            today={today}
            onSubmit={async (values) => {
              if (!reason.trim())
                throw new Error(t("Enter a correction reason."));
              const path = `/api/v1/tasks/${item.taskId}/corrections` as const;
              const account = await apiClient.get({
                subject: subject!,
                path: "/api/v1/account",
              });
              const body = { values, reason };
              if (
                !command.current ||
                command.current.body !== JSON.stringify(body)
              )
                command.current = apiClient.createCommand({
                  subject: subject!,
                  method: "POST",
                  path,
                  body,
                  streamVersion: account.streamVersion,
                });
              await apiClient.sendCommand(command.current);
              await queries.invalidateQueries({
                predicate: (q) => q.queryKey[1] === subject,
              });
              setOpen(false);
            }}
          />
          <button type="button" onClick={() => setOpen(false)}>
            {t("Cancel")}
          </button>
        </Modal>
      )}
    </>
  );
}
