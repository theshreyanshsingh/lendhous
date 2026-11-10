"use client";
import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import { pushKey, removePushSubscription, savePushSubscription, testPush } from "@/actions/push";

type State = "checking" | "unsupported" | "install" | "blocked" | "unavailable" | "off" | "on";
const DISMISSED = "lendhous-push-offer";

/** The VAPID key as the bytes PushManager wants. */
function keyBytes(base64: string) {
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

const iPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const installed = () => window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

/** Where this browser stands: what it can do, and whether it's already getting LendHous's notifications. */
async function currentState(): Promise<{ state: State; endpoint?: string }> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return { state: iPhone() && !installed() ? "install" : "unsupported" };
  if (Notification.permission === "denied") return { state: "blocked" };
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? { state: "on", endpoint: subscription.endpoint } : { state: "off" };
}

/**
 * Turning on notifications in this browser (lib/push.ts): payment reminders, draw decisions, documents needed and the rest
 * of what LendHous emails, on the lock screen as well. An iPhone needs LendHous on its home screen first. `offer` is the
 * one-time card on the borrower's home page; without it, the full control on the Notifications page.
 */
export function PushToggle({ offer = false }: { offer?: boolean }) {
  const [state, setState] = useState<State>("checking");
  const [endpoint, setEndpoint] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (offer) { try { if (localStorage.getItem(DISMISSED)) { setHidden(true); return; } } catch {} }
    void currentState().then((found) => { setState(found.state); setEndpoint(found.endpoint ?? ""); }, () => setState("unsupported"));
  }, [offer]);

  const turnOn = async () => {
    setBusy(true); setNote("");
    try {
      const key = await pushKey();
      if (!key) { setState("unavailable"); return; }
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "blocked" : "off"); return; }
      const subscription = await (await navigator.serviceWorker.ready).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
      const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const reply = await savePushSubscription({ endpoint: json.endpoint, keys: json.keys });
      if (reply.error) { await subscription.unsubscribe().catch(() => {}); setNote(reply.error); return; }
      setEndpoint(json.endpoint); setState("on"); setNote("Notifications are on in this browser.");
    } catch {
      setNote("This browser didn't let us turn them on. Try again, or check its notification settings.");
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    setBusy(true); setNote("");
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe().catch(() => false);
    await removePushSubscription(subscription?.endpoint ?? endpoint);
    setEndpoint(""); setState("off"); setBusy(false); setNote("Notifications are off in this browser.");
  };
  const test = async () => { setBusy(true); const reply = await testPush(); setBusy(false); setNote(reply.error ?? "Sent. It should show in a moment."); };
  const dismiss = () => { try { localStorage.setItem(DISMISSED, "1"); } catch {} setHidden(true); };

  if (offer) {
    if (hidden || (state !== "off" && state !== "install")) return null;
    return (
      <div className="glass flex items-start gap-3 p-4 text-sm" data-testid="push-offer">
        <BellRing className="mt-0.5 size-5 shrink-0 text-link" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Get updates on your phone</p>
          <p className="text-muted-foreground">{state === "install" ? "Add LendHous to your home screen (Share, then Add to Home Screen), open it from there, and turn on notifications: payments, draws and documents needed." : "Payment reminders, draw decisions and documents needed, the moment they happen."}</p>
          {state === "off" && <button type="button" className="btn-primary mt-2 h-10! px-4! text-sm!" data-testid="push-offer-on" disabled={busy} onClick={() => void turnOn()}>{busy ? "Turning on…" : "Turn on notifications"}</button>}
          {note && <p className="mt-1 text-xs text-muted-foreground" role="status">{note}</p>}
        </div>
        <button type="button" className="shrink-0 p-1 text-muted-foreground" aria-label="Not now" data-testid="push-offer-dismiss" onClick={dismiss}><X className="size-4" aria-hidden /></button>
      </div>
    );
  }

  const words: Record<State, string> = {
    checking: "Checking this browser…",
    unsupported: "This browser can't show notifications from websites. Email and this page still have everything.",
    install: "On an iPhone, notifications work once LendHous is on your home screen: tap Share, then Add to Home Screen, open it from there and come back here.",
    blocked: "Notifications from LendHous are blocked in this browser's settings. Allow them there, then turn them on here.",
    unavailable: "Notifications to phones aren't set up on this server yet. Email and this page still have everything.",
    off: "Off in this browser. Turn them on to get what we email you on this device's lock screen too.",
    on: "On in this browser: what we email you shows here too.",
  };
  return (
    <div className="space-y-2 text-sm" data-testid="push-toggle" data-state={state}>
      <p className="text-muted-foreground" data-testid="push-state">{words[state]}</p>
      <div className="flex flex-wrap gap-2">
        {state === "off" && <button type="button" className="btn-primary h-10! px-4! text-[13px]!" data-testid="push-on" disabled={busy} onClick={() => void turnOn()}>{busy ? "Turning on…" : "Turn on notifications"}</button>}
        {state === "on" && <><button type="button" className="btn-ghost h-10! px-4! text-[13px]!" data-testid="push-test" disabled={busy} onClick={() => void test()}>Send a test</button><button type="button" className="btn-ghost h-10! px-4! text-[13px]!" data-testid="push-off" disabled={busy} onClick={() => void turnOff()}>Turn off</button></>}
      </div>
      {note && <p className="text-xs text-muted-foreground" role="status" data-testid="push-note">{note}</p>}
    </div>
  );
}
