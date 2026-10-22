import { ProductVideo } from "@/components/landing/ProductVideo";

export function AutonomousDemo() {
  return (
    <ProductVideo
      base="autonomous-trading"
      url="tradewizard.live/portfolio-manager"
      ariaLabel="A 14 second demo of the TradeWizard Portfolio Manager: the Sniper persona scans 42 markets, enters a LONG YES position on the Fed rate cut market at 62 cents, arms a 54 cent stop and 78 cent target, and tracks the position to 69 cents for an unrealized gain of $5.64."
      posterAlt="TradeWizard Portfolio Manager dashboard showing three autonomous Sniper sessions, live activity feed, a LONG YES Fed rate cut position at 62 cents with a 69 cent mark, and armed safety rails."
      caption="Scan, enter, protect, exit. Every decision logged while you sleep."
      meta="The Sniper · Portfolio Manager"
    />
  );
}
