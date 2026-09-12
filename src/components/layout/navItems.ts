import { Home, UtensilsCrossed, Users, Wallet, BarChart3, Settings } from "lucide-react";

// Shared between BottomNav (phone) and SideNav (tablet landscape / desktop)
// so the two never drift out of sync.
// "Sessions" used to be its own tab — its tables/active/history view now
// lives on Home instead, so there's one less place to check.
export const navItems = [
  { to: "/", label: "Home", icon: Home },
  { to: "/canteen", label: "Canteen", icon: UtensilsCrossed },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/credits", label: "Credits", icon: Wallet },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];
