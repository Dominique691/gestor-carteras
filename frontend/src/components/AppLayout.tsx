import { LayoutDashboard, LogOut, Scale, TrendingUp } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ModeToggle } from "@/components/ModeToggle";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

const links = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/rebalance", label: "Rebalanceo", icon: Scale },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Al salir voluntariamente se vuelve a la landing; si la sesión caduca, ProtectedRoute lleva a /login.
  const handleLogout = () => {
    navigate("/", { replace: true });
    logout();
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-6">
          <div className="flex shrink-0 items-center gap-2 font-semibold">
            <TrendingUp className="size-5 text-primary" />
            <span className="hidden sm:inline">Gestor de Carteras</span>
          </div>
          <nav className="flex min-w-0 flex-1 items-center gap-1">
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors sm:px-3",
                    isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>
          <span className="hidden text-sm text-muted-foreground sm:inline">{user?.email}</span>
          <Button variant="outline" size="sm" className="shrink-0" onClick={handleLogout}>
            <LogOut /> Salir
          </Button>
          <ModeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4">
        <Outlet />
      </main>
      <Toaster richColors position="bottom-right" closeButton />
    </div>
  );
}
