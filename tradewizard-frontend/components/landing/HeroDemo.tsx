import { ProductVideo } from "@/components/landing/ProductVideo";

export function HeroDemo() {
  return (
    <ProductVideo
      base="analysis-demo"
      url="tradewizard.live/markets/fed-rate-cut"
      ariaLabel="A 14 second product demo: request an analysis on the Fed rate cut market, watch 14 AI agents work through 11 stages, then receive a LONG YES verdict at 71 percent versus a 62 cent market price."
      posterAlt="TradeWizard analysis result for the Fed rate cut market: LONG YES at 71 percent AI probability versus a 62 cent market price."
      caption="From request to verdict in 52 seconds. One loop, no cuts."
      meta="Fed Rate Cut · Polymarket"
    />
  );
}
