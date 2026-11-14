import { useState } from "react";
import { initials } from "../../lib/format";
import styles from "./Avatar.module.css";

export function Avatar({ name, url, size = 32 }: { name: string; url?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const dim = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  return (
    <span className={styles.avatar} style={dim} aria-hidden="true">
      {url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} /> : initials(name)}
    </span>
  );
}
