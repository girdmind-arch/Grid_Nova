// hi
import { useState } from "react";
import { Check, Hand, Pencil, X } from "lucide-react";
import type { ApprovalResponse, Decision } from "@/types/agents";
import { Button, IconTile, Modal, SegmentedControl } from "@/components/ui";

interface ApprovalCardProps {
  decision: Decision;
  onRespond: (response: ApprovalResponse) => Promise<void>;
}

/** Human-in-the-loop: the agent pauses a high-impact action until the operator decides. */
export function ApprovalCard({ decision, onRespond }: ApprovalCardProps) {
  const approval = decision.approval!;
  const options = approval.modifyOptions ?? [];
  const [busy, setBusy] = useState<ApprovalResponse["decision"] | null>(null);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [option, setOption] = useState(options[1]?.id ?? options[0]?.id ?? "");

  const send = async (response: ApprovalResponse) => {
    setBusy(response.decision);
    try {
      await onRespond(response);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div role="group" aria-label="Approval needed" className="rounded-md border border-warning/40 bg-warning/8 p-3.5">
      <div className="flex gap-3">
        <IconTile icon={<Hand />} tone="warning" size="sm" />
        <div className="min-w-0">
          <p className="micro-label text-warning">Your approval is needed</p>
          <p className="mt-1 text-sm font-semibold text-fg">{approval.request}</p>
          <p className="mt-1 text-[13px] text-fg-muted">
            <span className="font-semibold text-fg">Why: </span>
            {decision.chosenReason}
          </p>
          <p className="mt-1 text-[13px] text-fg-muted">
            <span className="font-semibold text-fg">Risk: </span>
            {approval.risk}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" disabled={!!busy} onClick={() => send({ decision: "approve" })}>
          <Check /> {busy === "approve" ? "Applying…" : "Approve"}
        </Button>
        {options.length > 0 && (
          <Button size="sm" disabled={!!busy} onClick={() => setModifyOpen(true)}>
            <Pencil /> Modify
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => send({ decision: "reject" })}>
          <X /> Reject
        </Button>
      </div>

      <Modal
        open={modifyOpen}
        onOpenChange={setModifyOpen}
        title="Modify the plan"
        description="Choose the hostel power level. Labs always keep full power."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModifyOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setModifyOpen(false);
                void send({ decision: "modify", optionId: option });
              }}
            >
              Apply this level
            </Button>
          </>
        }
      >
        <SegmentedControl
          label="Hostel power level"
          value={option}
          onChange={setOption}
          className="w-full"
          options={options.map((o) => ({ value: o.id, label: `${Math.round(Number(o.id) * 100)}%` }))}
        />
        <p className="mt-3 text-sm text-fg-muted">{options.find((o) => o.id === option)?.label}</p>
      </Modal>
    </div>
  );
}
