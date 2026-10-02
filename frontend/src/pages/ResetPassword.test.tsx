import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ForgotPasswordPage from "./ForgotPasswordPage";
import ResetPasswordPage from "./ResetPasswordPage";

const respond = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<p>login</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  localStorage.clear();
});

describe("recuperación de contraseña", () => {
  it("forgot-password muestra siempre el mensaje genérico", async () => {
    const fetchMock = vi.fn(() => respond(200, { message: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/forgot-password");

    await userEvent.type(screen.getByLabelText("Email"), "ana@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Enviar enlace" }));

    expect(await screen.findByText(/Si el email existe en nuestro sistema/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/forgot-password", expect.objectContaining({ method: "POST" }));
  });

  it("reset-password sin token avisa de enlace no válido", () => {
    renderAt("/reset-password");
    expect(screen.getByRole("alert")).toHaveTextContent("El enlace no es válido");
  });

  it("reset-password envía token y contraseña, y solo habilita el botón con una contraseña válida", async () => {
    const fetchMock = vi.fn(() => respond(200, { message: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/reset-password?token=abc123");

    const field = screen.getByLabelText("Nueva contraseña");
    const button = screen.getByRole("button", { name: "Restablecer contraseña" });
    await userEvent.type(field, "123456");
    expect(button).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.type(field, "Xq7!vL#92mZr$Tw");
    expect(button).toBeEnabled();
    await userEvent.click(button);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Contraseña actualizada"));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ token: "abc123", newPassword: "Xq7!vL#92mZr$Tw" });
  });

  it("muestra el error del backend si el token caducó", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond(400, { error: "El enlace no es válido o ha caducado" })));
    renderAt("/reset-password?token=viejo");

    await userEvent.type(screen.getByLabelText("Nueva contraseña"), "Xq7!vL#92mZr$Tw");
    await userEvent.click(screen.getByRole("button", { name: "Restablecer contraseña" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("ha caducado");
  });
});
