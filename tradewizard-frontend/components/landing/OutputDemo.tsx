import { ProductVideo } from "@/components/landing/ProductVideo";

export function OutputDemo() {
  return (
    <ProductVideo
      base="analysis-report"
      url="tradewizard.live/insights/fed-rate-cut"
      ariaLabel="A 14 second walkthrough of a TradeWizard analysis report: the LONG YES verdict at 71 percent versus a 62 cent market, all 14 agent findings including two dissenting agents, the bull and bear cases, cross-examination, and the final trade plan."
      posterAlt="TradeWizard analysis report showing 71 percent AI probability versus a 62 cent market, a breakdown of all 14 agent findings, and a LONG YES trade plan."
      caption="The full reasoning chain, every agent, and the dissent. Nothing hidden."
      meta="Analysis report · Fed Rate Cut"
    />
  );
}
