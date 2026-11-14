import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { setBackend } from "../../lib/backend";
import { MockBackend } from "../../lib/mockBackend";
import type { TaskRef } from "../../lib/types";
import { TaskPicker } from "./TaskPicker";

function setup() {
  setBackend(new MockBackend({ signedIn: true }));
  const onSelect = vi.fn<(t: TaskRef | null) => void>();
  const onStartRecent = vi.fn();
  const user = userEvent.setup();
  render(<TaskPicker onSelect={onSelect} onStartRecent={onStartRecent} />);
  const last = () => onSelect.mock.calls[onSelect.mock.calls.length - 1]?.[0];
  return { user, onSelect, onStartRecent, last };
}

describe("TaskPicker cascade", () => {
  it("shows a level only when the selected node has children", async () => {
    const { user, last } = setup();
    const project = await screen.findByRole("combobox", { name: "Project" });
    await waitFor(() => expect(screen.getAllByRole("option", { name: /Website Redesign/ })).toHaveLength(1));
    expect(screen.queryByRole("combobox", { name: "Task" })).not.toBeInTheDocument();

    await user.selectOptions(project, "Website Redesign (Acme Pvt Ltd)");
    const task = await screen.findByRole("combobox", { name: "Task" });
    expect(screen.queryByRole("combobox", { name: "Sub-task" })).not.toBeInTheDocument();

    // A leaf: no further level
    await user.selectOptions(task, "Pricing page");
    expect(screen.queryByRole("combobox", { name: "Sub-task" })).not.toBeInTheDocument();
    expect(last()).toMatchObject({ title: "Pricing page", projectName: "Website Redesign" });

    // A parent: sub-task level appears, and deeper
    await user.selectOptions(task, "Homepage ›");
    const sub = await screen.findByRole("combobox", { name: "Sub-task" });
    await user.selectOptions(sub, "Hero section ›");
    const subsub = await screen.findByRole("combobox", { name: "Sub-sub-task" });
    await user.selectOptions(subsub, "Copy review");
    expect(last()).toMatchObject({ taskId: 10112, title: "Copy review", projectId: 1, path: ["Homepage", "Hero section", "Copy review"] });
  });

  it("drops deeper levels when a higher level changes", async () => {
    const { user, last } = setup();
    const project = await screen.findByRole("combobox", { name: "Project" });
    await waitFor(() => expect(screen.getAllByRole("option", { name: /Mobile App/ })).toHaveLength(1));
    await user.selectOptions(project, "Website Redesign (Acme Pvt Ltd)");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Task" }), "Homepage ›");
    expect(await screen.findByRole("combobox", { name: "Sub-task" })).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Task" }), "Accessibility audit");
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Sub-task" })).not.toBeInTheDocument());
    expect(last()?.taskId).toBe(103);

    await user.selectOptions(project, "Internal Operations");
    expect(await screen.findByRole("option", { name: "Team meeting" })).toBeInTheDocument();
    expect(last()).toBeNull();
  });

  it("starts a recent task with one click", async () => {
    const { user, onStartRecent } = setup();
    await user.click(await screen.findByRole("button", { name: "Start Weekly status report" }));
    expect(onStartRecent).toHaveBeenCalledWith(expect.objectContaining({ title: "Weekly status report" }));
  });

  it("searches with a debounce and shows breadcrumbs", async () => {
    const { user, last } = setup();
    await user.type(await screen.findByRole("searchbox", { name: "Find a task" }), "hero");
    const hit = await screen.findByRole("button", { name: /^Hero section/ });
    expect(hit).toHaveTextContent("Website Redesign › Homepage");
    await user.click(hit);
    expect(last()).toMatchObject({ taskId: 1011 });
    expect(hit).toHaveAttribute("aria-pressed", "true");
  });

  it("says when nothing matches", async () => {
    const { user } = setup();
    await user.type(await screen.findByRole("searchbox", { name: "Find a task" }), "zzzz");
    expect(await screen.findByText(/No tasks match/)).toBeInTheDocument();
  });
});
