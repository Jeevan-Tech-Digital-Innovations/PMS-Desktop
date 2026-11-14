import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setBackend } from "../lib/backend";
import { MockBackend, type MockOptions } from "../lib/mockBackend";
import type { TaskRef } from "../lib/types";
import { AppStore } from "../state/store";
import { StoreProvider } from "../state/StoreProvider";

export const TASK: TaskRef = {
  taskId: 103,
  title: "Accessibility audit",
  projectId: 1,
  projectName: "Website Redesign",
  path: ["Accessibility audit"],
};

/** Mount the whole app against a fresh in-memory mock backend. */
export function setupApp(options: MockOptions = {}) {
  const mock = new MockBackend(options);
  setBackend(mock);
  const store = new AppStore();
  const user = userEvent.setup();
  const utils = render(
    <StoreProvider store={store}>
      <App />
    </StoreProvider>,
  );
  return { mock, store, user, ...utils };
}
