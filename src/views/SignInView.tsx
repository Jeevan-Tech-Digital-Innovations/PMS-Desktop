import { useState, type FormEvent } from "react";
import { Button } from "../components/Button/Button";
import { Icon } from "../components/Icon/Icon";
import { useStore } from "../state/StoreProvider";
import styles from "./SignInView.module.css";

export function SignInView() {
  const store = useStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    const res = await store.signIn(email.trim(), password);
    setLoading(false);
    if (!res.ok) setError(res.error.message);
  };

  return (
    <div className={styles.view}>
      <div className={styles.brand}>
        <span className={styles.logo}>
          <Icon name="clock" size={28} />
        </span>
        <h1 className={styles.title}>PMS Desktop</h1>
        <p className={styles.subtitle}>Sign in with your PMS account</p>
      </div>

      <form className={styles.form} onSubmit={submit} noValidate>
        <label className={styles.field}>
          <span>Email</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            required
          />
        </label>
        <label className={styles.field}>
          <span>Password</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            required
          />
        </label>
        {error && (
          <div className={styles.error} role="alert">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </div>
        )}
        <Button type="submit" variant="primary" size="lg" block disabled={loading || !email.trim() || !password}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
