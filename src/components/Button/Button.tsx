import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "../Icon/Icon";
import styles from "./Button.module.css";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "md" | "lg";
  icon?: IconName;
  block?: boolean;
  children: ReactNode;
};

export function Button({ variant = "secondary", size = "md", icon, block, className, children, type = "button", ...rest }: Props) {
  const cls = [styles.btn, styles[variant], styles[size], block ? styles.block : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} {...rest}>
      {icon && <Icon name={icon} size={size === "lg" ? 20 : 16} />}
      <span>{children}</span>
    </button>
  );
}
