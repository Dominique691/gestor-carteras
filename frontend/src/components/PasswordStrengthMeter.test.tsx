import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PasswordStrengthMeter } from "./PasswordStrengthMeter";

const segments = () => screen.getAllByTestId("strength-segment");
const met = () => screen.getAllByRole("listitem").filter((li) => li.dataset.met === "true").length;

describe("PasswordStrengthMeter", () => {
  it("sin contraseña no marca nada", () => {
    render(<PasswordStrengthMeter password="" />);
    expect(screen.getByText("Escribe una contraseña")).toBeInTheDocument();
    segments().forEach((s) => expect(s).toHaveClass("bg-muted"));
    expect(met()).toBe(0);
  });

  it("contraseña débil: rojo y nivel bajo", () => {
    render(<PasswordStrengthMeter password="123456" />);
    expect(screen.getByText(/^(Muy débil|Débil)$/)).toBeInTheDocument();
    expect(segments()[0]).toHaveClass("bg-red-500");
    expect(segments()[1]).toHaveClass("bg-muted");
  });

  it("contraseña muy fuerte: 4 segmentos verde oscuro y todos los requisitos", () => {
    render(<PasswordStrengthMeter password="Xq7!vL#92mZr$Tw" />);
    expect(screen.getByText("Muy fuerte")).toBeInTheDocument();
    segments().forEach((s) => expect(s).toHaveClass("bg-green-700"));
    expect(met()).toBe(4);
  });

  it("actualiza los requisitos al cambiar la contraseña", () => {
    const { rerender } = render(<PasswordStrengthMeter password="abcdefgh" />);
    expect(met()).toBe(1);
    rerender(<PasswordStrengthMeter password="Abcdefg1!" />);
    expect(met()).toBe(4);
  });
});
