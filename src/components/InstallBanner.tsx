import { useEffect, useState } from "react";
import { Card } from "./ui/Card";
import { useInstallPrompt } from "../hooks/useInstallPrompt";
import { Download, X, Share } from "lucide-react";

const DISMISSED_KEY = "cuebill-install-banner-dismissed";

function detectPlatform(): "ios" | "android" | "desktop" {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

// A one-line way to get the app onto whatever device someone's on, without
// hunting for the tiny install icon in the browser chrome. iOS can't be
// triggered programmatically (Apple doesn't allow it) so that case just
// shows the two-tap instructions instead of a button.
export function InstallBanner() {
  const { canPrompt, installed, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED_KEY) === "1");
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop">("desktop");

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  }

  if (installed || dismissed) return null;
  // Nothing useful to offer: not iOS, no APK relevant, and the browser
  // hasn't offered an install prompt (already installed elsewhere, or a
  // browser that doesn't support it at all).
  if (platform === "desktop" && !canPrompt) return null;

  return (
    <Card className="relative">
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 h-6 w-6 flex items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-faint)]"
        title="Dismiss"
      >
        <X size={12} />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <div className="h-10 w-10 rounded-xl bg-[var(--color-primary)]/15 text-[var(--color-primary)] flex items-center justify-center shrink-0">
          <Download size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Install CueBill as an app</p>

          {platform === "ios" && (
            <p className="text-xs text-[var(--color-text-dim)] mt-1 flex items-center gap-1 flex-wrap">
              Tap <Share size={12} className="inline shrink-0" /> Share, then "Add to Home Screen"
            </p>
          )}

          {platform === "android" && (
            <>
              <p className="text-xs text-[var(--color-text-dim)] mt-1">
                Opens full-screen, no browser bar, works like any other app.
              </p>
              <div className="flex items-center gap-2 mt-2">
                {canPrompt && (
                  <button
                    onClick={promptInstall}
                    className="rounded-lg bg-[var(--color-primary)] text-white text-xs font-medium px-3 py-2"
                  >
                    Install
                  </button>
                )}
                <a
                  href="/downloads/CueBill.apk"
                  download
                  className="rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs font-medium px-3 py-2"
                >
                  Download APK
                </a>
              </div>
            </>
          )}

          {platform === "desktop" && canPrompt && (
            <>
              <p className="text-xs text-[var(--color-text-dim)] mt-1">
                Opens in its own window with a taskbar icon, like a regular app.
              </p>
              <button
                onClick={promptInstall}
                className="rounded-lg bg-[var(--color-primary)] text-white text-xs font-medium px-3 py-2 mt-2"
              >
                Install
              </button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
