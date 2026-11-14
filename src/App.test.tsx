import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setupApp, TASK } from "./test/helpers";

describe("sign in", () => {
  it("shows the error message from the backend and keeps the form", async () => {
    const { user } = setupApp();
    await user.type(await screen.findByLabelText("Email"), "anita.rao@acme.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(screen.getByLabelText("Email")).toHaveValue("anita.rao@acme.com");
  });

  it("shows an offline error", async () => {
    const { user } = setupApp();
    await user.type(await screen.findByLabelText("Email"), "offline@acme.com");
    await user.type(screen.getByLabelText("Password"), "x");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Can't reach PMS/);
  });

  it("goes to the first-run notice, then the picker", async () => {
    const { user } = setupApp();
    await user.type(await screen.findByLabelText("Email"), "anita.rao@acme.com");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/activity \(screenshots, apps and idle time\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByRole("button", { name: "Start" })).toBeDisabled();
  });
});

describe("picker to timer", () => {
  it("starts a task from the cascade and renders the snapshot", async () => {
    const { user } = setupApp({ signedIn: true });
    await user.selectOptions(await screen.findByRole("combobox", { name: "Project" }), await screen.findByRole("option", { name: /Internal Operations/ }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Task" }), "Team meeting");
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByRole("heading", { name: "Team meeting" })).toBeInTheDocument();
    expect(screen.getByText("Working")).toBeInTheDocument();
  });

  it("offers a company switcher and shows the busy error while a timer runs", async () => {
    const { user, mock } = setupApp({ signedIn: true });
    await user.click(await screen.findByRole("button", { name: "Switch company" }));
    await user.click(screen.getByRole("menuitem", { name: "Globex Corporation" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Switch company" })).toHaveTextContent("Globex"));

    await act(async () => void (await mock.invoke("start_timer", { task: TASK })));
    await user.click(screen.getByRole("button", { name: "Switch company" }));
    await user.click(screen.getByRole("menuitem", { name: "Initech Software" }));
    expect(await screen.findByText("Stop the timer before switching company.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch company" })).toHaveTextContent("Globex");
  });
});

describe("timer view per state", () => {
  async function running() {
    const ctx = setupApp({ signedIn: true });
    await screen.findByRole("button", { name: "Start" });
    await act(async () => void (await ctx.mock.invoke("start_timer", { task: TASK })));
    await screen.findByRole("heading", { name: "Accessibility audit" });
    return ctx;
  }
  const update = (fn: () => unknown) => act(async () => void (await fn()));

  it("working: shows pill, clock, totals and Pause/Away/Break/Stop", async () => {
    const { mock } = await running();
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("0:00:00");
    expect(screen.getByText("6h 05m")).toBeInTheDocument();
    expect(screen.getByText("18m")).toBeInTheDocument();
    expect(screen.getByText("Website Redesign")).toBeInTheDocument();
    for (const name of ["Pause", "Away", "Break", "Stop"]) expect(screen.getByRole("button", { name })).toBeEnabled();

    // The UI renders what the backend says; it never counts time itself.
    await update(() => mock.tick());
    await update(() => mock.tick());
    expect(screen.getByRole("timer")).toHaveTextContent("0:00:02");
  });

  it("paused: Resume replaces Pause, Away and Break are disabled", async () => {
    const { user } = await running();
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(await screen.findByText("Paused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Away" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Break" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(await screen.findByText("Working")).toBeInTheDocument();
  });

  it("away and idle states", async () => {
    const { user, mock } = await running();
    await user.click(screen.getByRole("button", { name: "Away" }));
    await waitFor(() => expect(document.querySelector("[data-state=away]")).toHaveTextContent("Away"));
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    await update(() => mock.invoke("resume_timer"));
    await update(() => mock.triggerIdle("off"));
    expect(await screen.findByText("Idle")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("break: choose a reason, see time against the limit, then over the limit", async () => {
    const { user, mock } = await running();
    await user.click(screen.getByRole("button", { name: "Break" }));
    const sheet = await screen.findByRole("dialog", { name: "Take a break" });
    expect(await within(sheet).findByText("Lunch")).toBeInTheDocument();
    expect(within(sheet).getByText("Personal errand").parentElement).toHaveTextContent("No limit");
    await user.type(within(sheet).getByRole("searchbox"), "tea");
    expect(within(sheet).queryByText("Lunch")).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: /Tea/ }));

    expect(await screen.findByText("On break")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const panel = screen.getByRole("region", { name: "Break" });
    expect(panel).toHaveTextContent("of 15:00 limit");
    expect(screen.queryByText(/Over the limit/)).not.toBeInTheDocument();

    await update(() => mock.backdateBreak(17 * 60));
    expect(screen.getByRole("alert")).toHaveTextContent("Over the limit by 02:");

    await user.click(screen.getByRole("button", { name: "End break" }));
    expect(await screen.findByText("Working")).toBeInTheDocument();
  });

  it("offline banner shows the queue size", async () => {
    const { mock } = await running();
    await update(() => mock.setOnline(false));
    expect(screen.getByText(/Offline — tracking is saved and will sync/)).toHaveTextContent("(3 waiting)");
    await update(() => mock.setOnline(true));
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();
  });

  it("Change task opens the picker; Back to timer returns", async () => {
    const { user } = await running();
    await user.click(screen.getByRole("button", { name: "Change task" }));
    expect(await screen.findByRole("button", { name: "Switch to this task" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Back to timer/ }));
    expect(await screen.findByRole("timer")).toBeInTheDocument();
  });

  it("navigate event opens the picker", async () => {
    const { mock } = await running();
    await update(() => mock.navigate("picker"));
    expect(await screen.findByRole("button", { name: "Switch to this task" })).toBeInTheDocument();
  });

  it("asks before signing out while a timer runs", async () => {
    const { user } = await running();
    await user.click(screen.getByRole("button", { name: /Account menu/ }));
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    const dialog = await screen.findByRole("dialog", { name: "Sign out?" });
    await user.click(within(dialog).getByRole("button", { name: "Stop and sign out" }));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});

describe("prompts", () => {
  it("idle note: mandatory has no Skip, optional does; submit sends the text", async () => {
    const { user, mock } = setupApp({ signedIn: true });
    await screen.findByRole("button", { name: "Start" });
    await act(async () => void (await mock.invoke("start_timer", { task: TASK })));

    await act(async () => mock.triggerIdle("mandatory"));
    const dialog = await screen.findByRole("dialog", { name: "You were idle" });
    expect(within(dialog).queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Submit" })).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox"), "In a meeting");
    await user.click(within(dialog).getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mock.idleNotes).toEqual(["In a meeting"]);

    await act(async () => mock.endIdle(true));
    await act(async () => mock.triggerIdle("optional"));
    const optional = await screen.findByRole("dialog", { name: "You were idle" });
    await user.click(within(optional).getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("overtime prompt: Continue sets the overtime flag", async () => {
    const { user, mock } = setupApp({ signedIn: true });
    await screen.findByRole("button", { name: "Start" });
    await act(async () => void (await mock.invoke("start_timer", { task: TASK })));
    await act(async () => mock.triggerOvertime());
    const dialog = await screen.findByRole("dialog", { name: "Overtime" });
    expect(dialog).toHaveTextContent("You've worked 8 hours. Continue as overtime?");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(/Overtime/)).toBeInTheDocument();
  });

  it("silent mode shows no idle, overtime or event toasts", async () => {
    const { mock } = setupApp({ signedIn: true, trackingMode: "silent" });
    await screen.findByRole("button", { name: "Start" });
    await act(async () => void (await mock.invoke("start_timer", { task: TASK })));
    await act(async () => {
      mock.triggerIdle("mandatory");
      mock.triggerOvertime();
      mock.toast("info", "hello");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("hello")).not.toBeInTheDocument();
    expect(screen.getByText("Idle")).toBeInTheDocument();
  });

  it("toasts auto-hide after 3 seconds", async () => {
    const { mock } = setupApp({ signedIn: true });
    await screen.findByRole("button", { name: "Start" });
    await act(async () => mock.toast("success", "Saved"));
    expect(screen.getByText("Saved")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Saved")).not.toBeInTheDocument(), { timeout: 4000 });
  });
});
