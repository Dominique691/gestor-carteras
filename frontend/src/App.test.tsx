import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { ThemeProvider } from "./components/theme-provider";
import { AuthProvider } from "./context/AuthContext";
import { TOKEN_KEY } from "./lib/api";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );

const jsonResponse = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const emptyPortfolio = {
  totalValue: 0, totalInvested: 0, pnl: 0, pnlPercentage: 0, realizedPnl: 0, positions: [], targets: [],
};

beforeEach(() => {
  localStorage.clear();
  // Cartera vacía por defecto: estos tests solo comprueban rutas y sesión.
  vi.stubGlobal("fetch", vi.fn((url: string) =>
    jsonResponse(200, url === "/api/funds" || url === "/api/transactions" ? [] : emptyPortfolio),
  ));
});
afterEach(() => vi.unstubAllGlobals());

describe("rutas", () => {
  it("sin sesión redirige cualquier ruta protegida a /login", () => {
    renderAt("/dashboard");
    expect(screen.getByRole("heading", { name: /gestor de carteras/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument();
  });

  it("con token guardado permite entrar al dashboard y al rebalanceo", () => {
    localStorage.setItem(TOKEN_KEY, "token-de-prueba");
    renderAt("/rebalance");
    expect(screen.getByText("Simula una aportación y descubre dónde invertirla")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
  });

  it("con sesión iniciada /login redirige al dashboard", () => {
    localStorage.setItem(TOKEN_KEY, "token-de-prueba");
    renderAt("/login");
    expect(screen.getByText("Resumen de tu cartera")).toBeInTheDocument();
  });
});

describe("login", () => {
  it("guarda el JWT en localStorage y navega al dashboard", async () => {
    const user = { id: "1", email: "ana@example.com", createdAt: "2026-01-01T00:00:00.000Z" };
    const fetchMock = vi.fn((url: string) =>
      jsonResponse(200, url === "/api/auth/login" ? { token: "jwt-123", user } : emptyPortfolio),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderAt("/login");
    await userEvent.type(screen.getByLabelText("Email"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Contraseña"), "Secreta123");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(screen.getByText("Resumen de tu cartera")).toBeInTheDocument());
    expect(localStorage.getItem(TOKEN_KEY)).toBe("jwt-123");
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({ method: "POST" }));
  });

  it("muestra el error del backend y no guarda token si las credenciales son incorrectas", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(401, { error: "Credenciales incorrectas" })));

    renderAt("/login");
    await userEvent.type(screen.getByLabelText("Email"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Contraseña"), "mala");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Credenciales incorrectas");
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("con la cuenta sin verificar muestra el aviso y permite reenviar el enlace", async () => {
    const fetchMock = vi.fn((url: string) =>
      url === "/api/auth/login"
        ? jsonResponse(403, { error: "Debes verificar tu email antes de iniciar sesión." })
        : jsonResponse(200, { message: "Si hay una cuenta pendiente de verificar con ese email, recibirás un nuevo enlace" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderAt("/login");
    await userEvent.type(screen.getByLabelText("Email"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Contraseña"), "Secreta123!");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Debes verificar tu email");
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Reenviar enlace de activación" }));
    expect(await screen.findByText(/recibirás un nuevo enlace/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/auth/resend-verification",
      expect.objectContaining({ body: JSON.stringify({ email: "ana@example.com" }) }),
    );
  });

  it("cierra la sesión y vuelve a /login al pulsar Salir", async () => {
    localStorage.setItem(TOKEN_KEY, "token-de-prueba");
    renderAt("/dashboard");

    await userEvent.click(screen.getByRole("button", { name: /salir/i }));

    expect(await screen.findByRole("button", { name: "Entrar" })).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});

describe("registro", () => {
  it("no inicia sesión: pide revisar el correo y desde ahí vuelve al login", async () => {
    const message = "Te hemos enviado un email a ana@example.com para activar tu cuenta. El enlace caduca en 24 horas.";
    const fetchMock = vi.fn(() => jsonResponse(201, { message }));
    vi.stubGlobal("fetch", fetchMock);

    renderAt("/login");
    await userEvent.click(screen.getByRole("button", { name: "Regístrate" }));
    await userEvent.type(screen.getByLabelText("Email"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Contraseña"), "Cartera-Segura-2026!");
    await userEvent.click(screen.getByRole("button", { name: "Registrarme" }));

    expect(await screen.findByText("Revisa tu correo")).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/register", expect.objectContaining({ method: "POST" }));

    await userEvent.click(screen.getByRole("button", { name: "Ir a iniciar sesión" }));
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument();
  });
});
