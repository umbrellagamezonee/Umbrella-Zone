import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Home } from "./pages/Home";
import { Canteen } from "./pages/Canteen";
import { Customers } from "./pages/Customers";
import { Credits } from "./pages/Credits";
import { Reports } from "./pages/Reports";
import { Settings } from "./pages/Settings";
import { useCreditReminderWatcher } from "./hooks/useCreditReminderWatcher";
import { ThemeApplier } from "./components/ThemeApplier";

export default function App() {
  useCreditReminderWatcher();

  return (
    <>
      <ThemeApplier />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          {/* Sessions was merged into Home — keep the old path working for
              anyone with a bookmark or home-screen shortcut pointed at it. */}
          <Route path="/sessions" element={<Home />} />
          <Route path="/canteen" element={<Canteen />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/credits" element={<Credits />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </BrowserRouter>
    </>
  );
}
