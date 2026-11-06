"use client";
import { useEffect, useState } from "react";
import { Share, X } from "lucide-react";

const KEY = "lendhous-install-hint";
type InstallPrompt = Event & { prompt: () => Promise<void> };

/**
 * On a phone not yet running the portal from its home screen: how to put it there, so it opens full screen like an app.
 * Android offers it in one tap; an iPhone needs Safari's Share menu. Once dismissed or done, it's gone for good.
 */
export function InstallHint() {
  const [kind, setKind] = useState<null | "ios" | "android">(null);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    try { if (localStorage.getItem(KEY)) return; } catch { return; }
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    if (standalone) return;
    const agent = navigator.userAgent;
    if (/iPhone|iPod/.test(agent) && /Safari/.test(agent) && !/CriOS|FxiOS|EdgiOS/.test(agent)) setKind("ios");
    const offer = (event: Event) => { event.preventDefault(); setInstall(event as InstallPrompt); setKind("android"); };
    window.addEventListener("beforeinstallprompt", offer);
    return () => window.removeEventListener("beforeinstallprompt", offer);
  }, []);
  const done = () => { try { localStorage.setItem(KEY, "1"); } catch {} setKind(null); };
  if (!kind) return null;
  return (
    <div className="glass mb-4 flex items-start gap-3 p-3 text-sm md:hidden" data-testid="install-hint">
      <p className="min-w-0 flex-1">
        <b className="font-medium">Put LendHous on your home screen.</b>{" "}
        {kind === "ios" ? <>In Safari, tap <Share className="inline size-4 align-text-bottom" aria-label="Share" /> then <b className="font-medium">Add to Home Screen</b>. It opens full screen, like an app.</> : "It opens full screen, like an app."}
        {kind === "android" && install && <button type="button" className="btn-primary mt-2 h-10! w-full" onClick={() => { void install.prompt().finally(done); }}>Add it</button>}
      </p>
      <button type="button" className="grid size-9 shrink-0 place-items-center text-muted-foreground" aria-label="Not now" onClick={done}><X className="size-4" aria-hidden="true" /></button>
    </div>
  );
}
