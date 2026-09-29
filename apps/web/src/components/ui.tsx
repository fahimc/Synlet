import type {
  ComponentPropsWithoutRef,
  PropsWithChildren,
  ReactNode,
} from "react";

type SemanticProps = PropsWithChildren<{
  readonly variant?: string;
  readonly tone?: string;
  readonly gap?: string;
  readonly value?: string;
}>;

let composerValue = "";

export function readComposerValue(): string {
  return composerValue.trim();
}

export function clearComposerValue(): void {
  composerValue = "";
  const input = document.querySelector<HTMLInputElement>(".ui-input");
  if (input) input.value = "";
}

function classes(base: string, props: SemanticProps): string {
  return [
    base,
    props.variant && `is-${props.variant}`,
    props.tone && `tone-${props.tone}`,
    props.gap && `gap-${props.gap}`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function Page({ children }: SemanticProps) {
  return <main className="ui-page">{children}</main>;
}
export function Stack(props: SemanticProps) {
  return <div className={classes("ui-stack", props)}>{props.children}</div>;
}
export function Row(props: SemanticProps) {
  return <div className={classes("ui-row", props)}>{props.children}</div>;
}
export function Section(props: SemanticProps) {
  return (
    <section className={classes("ui-section", props)}>{props.children}</section>
  );
}
export function Card(props: SemanticProps) {
  return (
    <article className={classes("ui-card", props)}>{props.children}</article>
  );
}
export function Spacer() {
  return <span className="ui-spacer" />;
}
export function Divider() {
  return <hr className="ui-divider" />;
}

export function Heading({
  level = 2,
  children,
}: PropsWithChildren<{ readonly level?: number }>) {
  const Tag =
    `h${Math.max(1, Math.min(6, level))}` as keyof React.JSX.IntrinsicElements;
  return <Tag className="ui-heading">{children}</Tag>;
}

export function Text({
  children,
  tone,
}: PropsWithChildren<{ readonly tone?: string }>) {
  return (
    <p className={classes("ui-text", { children, ...(tone ? { tone } : {}) })}>
      {children}
    </p>
  );
}

export function Badge({
  children,
  tone,
}: PropsWithChildren<{ readonly tone?: string }>) {
  return (
    <span
      className={classes("ui-badge", { children, ...(tone ? { tone } : {}) })}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  variant,
  ...props
}: ComponentPropsWithoutRef<"button"> & { readonly variant?: string }) {
  return (
    <button
      type="button"
      className={`ui-button is-${variant ?? "primary"}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input(props: ComponentPropsWithoutRef<"input">) {
  const inputProps = { ...props };
  delete inputProps.value;
  return (
    <input
      {...inputProps}
      className="ui-input"
      defaultValue={composerValue}
      onChange={(event) => {
        composerValue = event.currentTarget.value;
      }}
    />
  );
}

export function Icon({ name }: { readonly name?: string }): ReactNode {
  return (
    <span className={`ui-icon icon-${name ?? "node"}`} aria-hidden="true" />
  );
}

export const Grid = Stack;
export const Link = ({ children, ...props }: ComponentPropsWithoutRef<"a">) => (
  <a {...props}>{children}</a>
);
export const Image = (props: ComponentPropsWithoutRef<"img">) => (
  <img {...props} />
);
export const Select = (props: ComponentPropsWithoutRef<"select">) => (
  <select {...props} />
);
export const Checkbox = (props: ComponentPropsWithoutRef<"input">) => (
  <input type="checkbox" {...props} />
);
export const Switch = Checkbox;
export const Alert = Card;
export const Spinner = () => (
  <span className="ui-spinner" aria-label="Loading" />
);
export const Metric = Text;
export const Field = Stack;
