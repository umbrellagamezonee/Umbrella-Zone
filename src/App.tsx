import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Home } from "./pages/Home";
import { Sessions } from "./pages/Sessions";
import { Canteen } from "./pages/Canteen";
import { Customers } from "./pages/Customers";
import { Reports } from "./pages/Reports";
import { Settings } from "./pages/Settings";
import { useCreditReminderWatcher } from "./hooks/useCreditReminderWatcher";
import { LockScreen } from "./components/LockScreen";
import { ThemeApplier } from "./components/ThemeApplier";

export default function App() {
  useCreditReminderWatcher();

  return (
    <>
      <ThemeApplier />
      <LockScreen>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/canteen" element={<Canteen />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </BrowserRouter>
      </LockScreen>
    </>
  );
}
