import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModeToggle } from "./ModeToggle";
import { ThemeProvider } from "./theme-provider";

let systemDark = false;
let listeners: ((e: { matches: boolean }) => void)[] = [];

beforeEach(() => {
  systemDark = false;
  listeners = [];
  localStorage.clear();
  document.documentElement.className = "";
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return systemDark;
    },
    media: query,
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.push(cb),
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
      listeners = listeners.filter((l) => l !== cb);
    },
  }));
});
afterEach(() => vi.unstubAllGlobals());

const renderToggle = () =>
  render(
    <ThemeProvider>
      <ModeToggle />
    </ThemeProvider>,
  );

async function choose(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Cambiar tema" }));
  await user.click(await screen.findByRole("menuitem", { name: new RegExp(name) }));
}

describe("ThemeProvider + ModeToggle", () => {
  it("elegir Oscuro añade .dark y lo guarda en localStorage", async () => {
    renderToggle();
    expect(document.documentElement).not.toHaveClass("dark");
    await choose("Oscuro");
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("ui-theme")).toBe("dark");
  });

  it("elegir Claro quita .dark", async () => {
    localStorage.setItem("ui-theme", "dark");
    renderToggle();
    expect(document.documentElement).toHaveClass("dark");
    await choose("Claro");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem("ui-theme")).toBe("light");
  });

  it("recupera el tema guardado al montar", () => {
    localStorage.setItem("ui-theme", "dark");
    renderToggle();
    expect(document.documentElement).toHaveClass("dark");
  });

  it("Sistema sigue la preferencia del SO, también cuando cambia", async () => {
    systemDark = true;
    renderToggle();
    expect(document.documentElement).toHaveClass("dark"); // por defecto: system
    await choose("Sistema");
    expect(localStorage.getItem("ui-theme")).toBe("system");
    expect(document.documentElement).toHaveClass("dark");

    systemDark = false;
    await vi.waitFor(() => {
      listeners.forEach((l) => l({ matches: false }));
      expect(document.documentElement).not.toHaveClass("dark");
    });
  });

  it("resalta el modo activo", async () => {
    localStorage.setItem("ui-theme", "dark");
    renderToggle();
    await userEvent.setup().click(screen.getByRole("button", { name: "Cambiar tema" }));
    expect(await screen.findByRole("menuitem", { name: /Oscuro/ })).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("menuitem", { name: "Claro" })).toHaveAttribute("data-active", "false");
  });
});
