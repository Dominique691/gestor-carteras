import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import VerifyEmailPage from "./VerifyEmailPage";

const respond = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const renderAt = (path: string) =>
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/login" element={<p>pantalla de login</p>} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );

afterEach(() => vi.unstubAllGlobals());

describe("verificación de email", () => {
  it("envía el token una sola vez (también en StrictMode) y muestra el éxito con acceso al login", async () => {
    const fetchMock = vi.fn(() => respond(200, { message: "Email verificado. Ya puedes iniciar sesión." }));
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/verify-email?token=abc123");

    expect(screen.getByText("Verificando tu email…")).toBeInTheDocument();
    expect(await screen.findByText("¡Email verificado!")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/verify-email",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ token: "abc123" }) }),
    );

    await userEvent.click(screen.getByRole("link", { name: "Iniciar sesión" }));
    expect(screen.getByText("pantalla de login")).toBeInTheDocument();
  });

  it("si el enlace caducó lo indica y permite pedir uno nuevo", async () => {
    const fetchMock = vi.fn((url: string) =>
      url === "/api/auth/verify-email"
        ? respond(410, { error: "El enlace de activación ha caducado. Solicita uno nuevo." })
        : respond(200, { message: "Si hay una cuenta pendiente de verificar con ese email, recibirás un nuevo enlace" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/verify-email?token=viejo");

    expect(await screen.findByRole("alert")).toHaveTextContent("El enlace ha caducado");

    await userEvent.type(screen.getByLabelText("Email"), "ana@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Reenviar enlace de activación" }));

    expect(await screen.findByText(/recibirás un nuevo enlace/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/auth/resend-verification",
      expect.objectContaining({ body: JSON.stringify({ email: "ana@example.com" }) }),
    );
  });

  it("con un token no válido muestra el error del backend", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond(400, { error: "El enlace de activación no es válido o ya se ha usado" })));
    renderAt("/verify-email?token=otro");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("El enlace no es válido");
    expect(alert).toHaveTextContent("ya se ha usado");
  });

  it("sin token no llama al backend", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/verify-email");

    expect(screen.getByRole("alert")).toHaveTextContent("Falta el código de activación");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
