import { useState } from "react";
import { useAppState, useStore } from "../../state/StoreProvider";
import { Avatar } from "../Avatar/Avatar";
import { Button } from "../Button/Button";
import { Icon } from "../Icon/Icon";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../Menu/Menu";
import { Sheet } from "../Sheet/Sheet";
import type { Session } from "../../lib/types";
import styles from "./Header.module.css";

export function Header({ session }: { session: Session }) {
  const store = useStore();
  const appInfo = useAppState((s) => s.appInfo);
  const running = useAppState((s) => s.timer.state !== "stopped");
  const [confirming, setConfirming] = useState(false);

  const active = session.companies.find((c) => c.tenantId === session.activeTenantId) ?? session.companies[0];
  const multi = session.companies.length > 1;

  const companyItems = (close: () => void) =>
    session.companies.map((c) => (
      <MenuItem
        key={c.tenantId}
        icon="building"
        checked={c.tenantId === session.activeTenantId}
        onSelect={() => {
          close();
          if (c.tenantId !== session.activeTenantId) void store.switchCompany(c.tenantId);
        }}
      >
        {c.name}
      </MenuItem>
    ));

  const requestSignOut = () => (running ? setConfirming(true) : void store.signOut());

  return (
    <header className={styles.header}>
      {multi ? (
        <Menu
          label="Switch company"
          triggerClassName={styles.company}
          trigger={
            <>
              <Icon name="building" size={16} />
              <span className={styles.companyName}>{active?.name}</span>
              <Icon name="chevronDown" size={16} />
            </>
          }
        >
          {({ close }) => (
            <>
              <MenuLabel>Company</MenuLabel>
              {companyItems(close)}
            </>
          )}
        </Menu>
      ) : (
        <div className={styles.companyStatic}>
          <Icon name="building" size={16} />
          <span className={styles.companyName}>{active?.name}</span>
        </div>
      )}

      <Menu
        label={`Account menu for ${session.user.displayName}`}
        align="right"
        triggerClassName={styles.avatarButton}
        trigger={<Avatar name={session.user.displayName} url={session.user.avatarUrl} />}
      >
        {({ close }) => (
          <>
            <div className={styles.who}>
              <strong>{session.user.displayName}</strong>
              <span>{session.user.email}</span>
            </div>
            <MenuSeparator />
            {multi && (
              <>
                <MenuLabel>Switch company</MenuLabel>
                {companyItems(close)}
                <MenuSeparator />
              </>
            )}
            <MenuItem
              icon="external"
              onSelect={() => {
                close();
                void store.openPms();
              }}
            >
              Open PMS
            </MenuItem>
            <MenuItem
              icon="logout"
              danger
              onSelect={() => {
                close();
                requestSignOut();
              }}
            >
              Sign out
            </MenuItem>
            <MenuSeparator />
            <div className={styles.version}>
              {appInfo ? `PMS Desktop v${appInfo.version}${appInfo.dev ? " (dev)" : ""}` : "PMS Desktop"}
            </div>
          </>
        )}
      </Menu>

      {confirming && (
        <Sheet
          variant="dialog"
          title="Sign out?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button onClick={() => setConfirming(false)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirming(false);
                  void store.signOut();
                }}
              >
                Stop and sign out
              </Button>
            </>
          }
        >
          A timer is running. Signing out will stop it.
        </Sheet>
      )}
    </header>
  );
}
