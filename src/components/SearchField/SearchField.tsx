import { useId } from "react";
import { Icon } from "../Icon/Icon";
import styles from "./SearchField.module.css";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
};

export function SearchField({ value, onChange, placeholder, label }: Props) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span className={styles.icon}>
        <Icon name="search" size={16} />
      </span>
      <input
        id={id}
        className={styles.input}
        type="search"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
