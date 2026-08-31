import { Home, ListChecks, UtensilsCrossed, Users, BarChart3, Settings } from "lucide-react";

// Shared between BottomNav (phone) and SideNav (tablet landscape / desktop)
// so the two never drift out of sync.
export const navItems = [
  { to: "/", label: "Home", icon: Home },
  { to: "/sessions", label: "Sessions", icon: ListChecks },
  { to: "/canteen", label: "Canteen", icon: UtensilsCrossed },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];
