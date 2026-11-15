import { Input } from "@vango-panel/ui/components/input";
import { Label } from "@vango-panel/ui/components/label";
import { cn } from "@vango-panel/ui/lib/utils";
import * as React from "react";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const autoId = React.useId();
  const hintId = `${autoId}-hint`;
  const kids = React.Children.toArray(children);
  const first = kids[0];
  let controlId: string | undefined;
  if (React.isValidElement<{ id?: string; "aria-describedby"?: string }>(first)) {
    controlId = first.props.id ?? autoId;
    kids[0] = React.cloneElement(first, {
      id: controlId,
      "aria-describedby": [first.props["aria-describedby"], hint ? hintId : undefined].filter(Boolean).join(" ") || undefined,
    });
  }
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={controlId}>{label}</Label>
      {kids}
      {hint ? (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const controlClass =
  "w-full min-w-0 rounded-none border border-input bg-transparent px-2.5 py-1.5 text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30";

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(controlClass, "h-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(controlClass, "min-h-24 font-mono", className)} {...props} />;
}

export function NumberInput({
  value,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Input
      type="number"
      value={Number.isFinite(value) ? value : ""}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      {...props}
    />
  );
}

export function PageShell({
  title,
  description,
  actions,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-semibold text-xl">{title}</h1>
          {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto ring-1 ring-foreground/10">
      <table
        className={cn(
          "w-full text-left text-xs [&_tbody_tr]:border-t [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_th]:font-medium [&_th]:text-muted-foreground",
          className,
        )}
        {...props}
      />
    </div>
  );
}
