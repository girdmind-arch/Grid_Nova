// hi
import { Link } from "react-router";
import { Compass } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-[var(--gutter)]">
      <EmptyState
        icon={<Compass />}
        tone="accent"
        title="This page isn't on the grid"
        description="The link may be old or mistyped. The Control Room is a good place to start."
        action={
          <Button asChild variant="primary">
            <Link to="/app">Go to Control Room</Link>
          </Button>
        }
      />
    </div>
  );
}
