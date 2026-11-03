// hi
import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/utils/cn";
import { Button } from "./Button";

// Accessible dialog: traps focus, closes on Escape, returns focus on close.
// variant "center" is a classic modal; "sheet" slides up from the bottom (mobile);
// "full" fills the screen (e.g. the live grid on a projector).

interface ModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the modal (optional when controlled). */
  trigger?: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Buttons row at the bottom. */
  footer?: ReactNode;
  variant?: "center" | "sheet" | "full";
  className?: string;
}

export function Modal({ open, onOpenChange, trigger, title, description, children, footer, variant = "center", className }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
        <Dialog.Content
          className={cn(
            "glass-strong fixed z-50 flex flex-col border border-glass-border bg-surface-solid/92 shadow-lg focus-visible:outline-none",
            variant === "center" &&
              "top-1/2 left-1/2 max-h-[85dvh] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl data-[state=open]:animate-pop-in data-[state=closed]:animate-fade-out",
            variant === "full" &&
              "inset-2 rounded-xl sm:inset-6 data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
            variant === "sheet" &&
              "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl pb-[env(safe-area-inset-bottom)] data-[state=open]:animate-sheet-in data-[state=closed]:animate-sheet-out",
            className,
          )}
        >
          {variant === "sheet" && <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-border-strong" />}
          <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-bold text-fg">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-fg-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close" className="-mt-1.5 -mr-2">
                <X />
              </Button>
            </Dialog.Close>
          </div>
          {children && (
            <div
              className={cn(
                "min-h-0 overflow-y-auto px-5 py-4 sm:px-6",
                variant === "full" && "flex flex-1 flex-col justify-center",
              )}
            >
              {children}
            </div>
          )}
          {footer && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-4 sm:px-6">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const ModalClose = Dialog.Close;
