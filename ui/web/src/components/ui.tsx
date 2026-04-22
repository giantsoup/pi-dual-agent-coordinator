import { forwardRef, type ReactElement, type ReactNode, type TextareaHTMLAttributes } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as RadixTabs from "@radix-ui/react-tabs";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { X } from "lucide-react";

export type Tone = "neutral" | "accent" | "warning" | "danger" | "success";
export type Actor = "coordinator" | "A" | "B" | "unknown";

export function Button(props: {
  children: ReactNode;
  disabled?: boolean | undefined;
  icon?: ReactNode;
  onClick?(): void;
  tone?: Tone | undefined;
  type?: "button" | "submit" | "reset" | undefined;
  variant?: "primary" | "secondary" | "ghost" | undefined;
}): ReactElement {
  return (
    <button
      className="ui-button"
      data-tone={props.tone ?? "neutral"}
      data-variant={props.variant ?? "secondary"}
      disabled={props.disabled}
      type={props.type ?? "button"}
      onClick={props.onClick}
    >
      {props.icon ? <span className="ui-button__icon">{props.icon}</span> : null}
      <span>{props.children}</span>
    </button>
  );
}

export function IconButton(props: {
  "aria-label": string;
  disabled?: boolean | undefined;
  icon: ReactNode;
  onClick?(): void;
  tone?: Tone | undefined;
  tooltip: string;
}): ReactElement {
  return (
    <Tooltip content={props.tooltip}>
      <button
        aria-label={props["aria-label"]}
        className="icon-button"
        data-tone={props.tone ?? "neutral"}
        disabled={props.disabled}
        type="button"
        onClick={props.onClick}
      >
        {props.icon}
      </button>
    </Tooltip>
  );
}

export function Badge(props: {
  children: ReactNode;
  tone?: Tone | undefined;
}): ReactElement {
  return (
    <span className="badge" data-tone={props.tone ?? "neutral"}>
      {props.children}
    </span>
  );
}

export function StatusDot(props: {
  tone?: Tone | undefined;
  label?: string | undefined;
}): ReactElement {
  return (
    <span className="status-dot" data-tone={props.tone ?? "neutral"}>
      {props.label ? <span>{props.label}</span> : null}
    </span>
  );
}

export function ActorMarker(props: {
  actor: Actor;
  label?: string | undefined;
}): ReactElement {
  return (
    <span className="actor-marker" data-actor={props.actor}>
      <span className="actor-marker__dot" />
      {props.label ? <span>{props.label}</span> : null}
    </span>
  );
}

export function Toolbar(props: { children: ReactNode }): ReactElement {
  return <div className="toolbar">{props.children}</div>;
}

export function Tabs(props: {
  defaultValue: string;
  items: Array<{ label: string; value: string; content: ReactNode }>;
}): ReactElement {
  return (
    <RadixTabs.Root className="tabs" defaultValue={props.defaultValue}>
      <RadixTabs.List className="tabs-list" aria-label="Inspector sections">
        {props.items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            className="tabs-trigger"
            value={item.value}
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {props.items.map((item) => (
        <RadixTabs.Content key={item.value} className="tabs-content" value={item.value}>
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}

export function Drawer(props: {
  children: ReactNode;
  onOpenChange(open: boolean): void;
  open: boolean;
  title: string;
}): ReactElement {
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-backdrop" />
        <Dialog.Content
          className="drawer-shell"
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            props.onOpenChange(false);
          }}
        >
          <header className="drawer-header">
            <div>
              <div className="section-kicker">Shared Modal</div>
              <Dialog.Title className="drawer-title">{props.title}</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <IconButton aria-label="Close drawer" tooltip="Close drawer" icon={<X />} />
            </Dialog.Close>
          </header>
          <div className="drawer-body">{props.children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Tooltip(props: {
  children: ReactNode;
  content: ReactNode;
}): ReactElement {
  return (
    <RadixTooltip.Provider delayDuration={250}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{props.children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content className="tooltip-content" sideOffset={6}>
            {props.content}
            <RadixTooltip.Arrow className="tooltip-arrow" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}

export function NoticeBanner(props: {
  children: ReactNode;
  onDismiss?: (() => void) | undefined;
  tone: "info" | "error";
}): ReactElement {
  return (
    <section
      aria-live={props.tone === "error" ? "assertive" : "polite"}
      className="notice-banner"
      data-tone={props.tone}
      role={props.tone === "error" ? "alert" : "status"}
    >
      <span>{props.children}</span>
      {props.onDismiss ? (
        <Button variant="ghost" tone={props.tone === "error" ? "danger" : "accent"} onClick={props.onDismiss}>
          Dismiss
        </Button>
      ) : null}
    </section>
  );
}

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea(props, ref): ReactElement {
  return (
    <textarea
      {...props}
      ref={ref}
      className={`textarea ${props.className ?? ""}`}
    />
  );
});

export function KeyValueList(props: {
  rows: Array<[string, ReactNode]>;
}): ReactElement {
  return (
    <dl className="key-value-list">
      {props.rows.map(([label, value], index) => (
        <div key={`${label}:${index}`} className="key-value-row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionHeader(props: {
  actions?: ReactNode;
  kicker?: string | undefined;
  title: string;
}): ReactElement {
  return (
    <header className="section-header">
      <div>
        {props.kicker ? <div className="section-kicker">{props.kicker}</div> : null}
        <h2>{props.title}</h2>
      </div>
      {props.actions ? <div className="section-actions">{props.actions}</div> : null}
    </header>
  );
}

export function SplitPane(props: {
  left: ReactNode;
  right: ReactNode;
}): ReactElement {
  return (
    <main className="split-pane">
      {props.left}
      {props.right}
    </main>
  );
}

export function TimelineRow(props: {
  actor?: Actor | undefined;
  children: ReactNode;
  meta: ReactNode;
}): ReactElement {
  return (
    <article className="timeline-row" data-actor={props.actor ?? "unknown"}>
      <div className="timeline-marker" />
      <div className="timeline-content">
        <div className="timeline-meta">{props.meta}</div>
        {props.children}
      </div>
    </article>
  );
}
