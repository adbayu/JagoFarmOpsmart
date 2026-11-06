import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
export function PageHeader({
  eyebrow,
  title,
  description,
  visual = "module",
}: {
  eyebrow?: string;
  title: string;
  description: string;
  visual?:
    | "farm"
    | "fish"
    | "chicken"
    | "crop"
    | "module"
    | "operations"
    | "inventory"
    | "harvest"
    | "circular"
    | "water"
    | "records"
    | "education";
}) {
  return (
    <header className={`page-header page-header-${visual}`}>
      <div className="page-header-copy">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </header>
  );
}
export function Card({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`.trim()}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
export function StatePanel({
  kind,
  title,
  children,
  onRetry,
}: {
  kind: "empty" | "loading" | "error" | "success";
  title: string;
  children?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <section
      className={`state-panel ${kind}`}
      role={kind === "error" ? "alert" : "status"}
      aria-live="polite"
      aria-busy={kind === "loading"}
    >
      <h2>{title}</h2>
      <p>{children}</p>
      {onRetry && <button onClick={onRetry}>Coba lagi</button>}
    </section>
  );
}
export function FormField({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  const input = isValidElement<{
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
  }>(children)
    ? cloneElement(children, {
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error
          ? [children.props["aria-describedby"], `${id}-error`]
              .filter(Boolean)
              .join(" ")
          : children.props["aria-describedby"],
      })
    : children;
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      {input}
      {error && (
        <p id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  emptyMessage = "Belum ada catatan.",
}: {
  caption: string;
  columns: { key: string; label: string; render: (row: T) => ReactNode }[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
}) {
  return (
    <div className="table-scroll">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => (
                <td key={c.key}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="table-empty">{emptyMessage}</p>}
    </div>
  );
}
/** Native modal provides focus containment/Escape. Parent awaits confirmed command and shows errors. */
export function ConfirmDialog({
  open,
  title,
  children,
  onConfirm,
  onClose,
  busy = false,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open) ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div>{children}</div>
      <div className="actions">
        <button autoFocus disabled={busy} onClick={onClose}>
          Batal
        </button>
        <button className="button-danger" disabled={busy} onClick={onConfirm}>
          Konfirmasi
        </button>
      </div>
    </dialog>
  );
}
