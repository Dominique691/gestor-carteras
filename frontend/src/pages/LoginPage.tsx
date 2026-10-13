import { TrendingUp } from "lucide-react";
import { AuthCard } from "@/components/AuthCard";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center">
          <TrendingUp className="mx-auto size-8 text-primary" aria-hidden />
          <h1 className="text-xl font-semibold">Gestor de Carteras</h1>
        </div>
        <AuthCard />
      </div>
    </div>
  );
}
