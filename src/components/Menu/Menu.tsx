import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "../Icon/Icon";
import styles from "./Menu.module.css";

type MenuProps = {
  /** Accessible name of the trigger button. */
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  align?: "left" | "right";
  children: (api: { close: () => void }) => ReactNode;
};

/** Small popover menu: click-outside and Esc close it, arrow keys move between items. */
export function Menu({ label, trigger, triggerClassName, align = "left", children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    root.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      close();
    } else if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const items = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
    }
  };

  return (
    <div className={styles.root} ref={root} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div id={id} role="menu" aria-label={label} className={`${styles.panel} ${align === "right" ? styles.right : styles.left}`}>
          {children({ close: () => close() })}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  checked,
  disabled,
  danger,
  onSelect,
  children,
}: {
  icon?: IconName;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`${styles.item} ${danger ? styles.danger : ""}`}
      disabled={disabled}
      onClick={onSelect}
    >
      {icon ? <Icon name={icon} size={16} /> : <span className={styles.iconGap} />}
      <span className={styles.itemText}>{children}</span>
      {checked && <Icon name="check" size={16} />}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className={styles.label} role="presentation">
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div className={styles.sep} role="separator" />;
}
