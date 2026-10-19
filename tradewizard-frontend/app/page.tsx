import Link from "next/link";
import { MarketingShell } from "@/components/shell/MarketingShell";
import { PLAN_CAPABILITIES } from "@/constants/plans";
import { BrowserFrame } from "@/components/landing/BrowserFrame";

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "",
    credits: "20 credits/month",
    featured: false,
    trial: false,
    features: [
      "Full analysis depth (all 14 agents)",
      "One-time analyses only",
      "In-app delivery",
      "Market browsing + trading",
    ],
  },
  {
    name: "Starter",
    price: "$19",
    period: "/mo",
    credits: "100 credits/month",
    featured: false,
    trial: true,
    features: [
      "Daily recurring analysis",
      "Email + push notifications",
      "Performance analytics",
      "Credit top-up packs",
    ],
  },
  {
    name: "Pro",
    price: "$49",
    period: "/mo",
    credits: "350 credits/month",
    featured: true,
    trial: true,
    features: [
      "All intervals (1h → daily)",
      "All notification channels",
      "Webhook delivery",
      `Portfolio Manager (${PLAN_CAPABILITIES.pro.pmSessionLimit} markets)`,
      "Priority execution queue",
    ],
  },
  {
    name: "Elite",
    price: "$149",
    period: "/mo",
    credits: "Unlimited",
    featured: false,
    trial: false,
    features: [
      "Everything in Pro",
      "Unlimited analyses",
      `Portfolio Manager (${PLAN_CAPABILITIES.elite.pmSessionLimit} markets)`,
      "Custom persona tuning",
      "API access",
    ],
  },
] as const;

const PIPELINE_STAGES = [
  { label: "Data Collection", detail: "Price history, related markets, web research" },
  { label: "14 Intelligence Agents", detail: "Parallel analysis from 14 methodologies" },
  { label: "Signal Fusion", detail: "Weighted aggregation + conflict detection" },
  { label: "Thesis Construction", detail: "Competing bull & bear cases" },
  { label: "Cross-Examination", detail: "5 adversarial stress tests" },
  { label: "Consensus Engine", detail: "Final probability + confidence band" },
  { label: "Recommendation", detail: "Entry/exit zones, sizing, risk factors" },
] as const;

const AGENTS = [
  "Market Microstructure",
  "Probability Baseline",
  "Risk Assessment",
  "Breaking News",
  "Event Impact",
  "Polling Intelligence",
  "Historical Patterns",
  "Media Sentiment",
  "Social Sentiment",
  "Narrative Velocity",
  "Momentum",
  "Mean Reversion",
  "Catalyst ID",
  "Tail Risk",
] as const;

const STATS = [
  { value: "14", label: "AI Agents" },
  { value: "11", label: "Analysis Stages" },
  { value: "<60s", label: "Full Analysis" },
  { value: "24/7", label: "Autonomous Trading" },
] as const;

export default function LandingPage() {
  return (
    <MarketingShell>
      {/* ─── HERO ─── */}
      <section className="w-full px-4 sm:px-6 pt-[clamp(5rem,12vw,10rem)] pb-[clamp(4rem,8vw,6rem)]">
        <div className="flex flex-col items-center text-center">
          {/* Status pill */}
          <div className="inline-flex items-center gap-2 bg-surface border border-border rounded-full px-4 py-1.5 text-[0.8rem] text-muted mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-yes animate-pulse" />
            Live on Polymarket - analyzing markets now
          </div>

          <h1 className="font-display text-[clamp(2.5rem,6vw,4.5rem)] font-bold tracking-[-0.03em] leading-[1.05] mb-6 max-w-[800px]">
            Stop Guessing.{" "}
            <span className="bg-gradient-to-br from-accent to-ai bg-clip-text text-transparent">
              Trade with Intelligence.
            </span>
          </h1>

          <p className="text-[clamp(1.05rem,1.6vw,1.3rem)] text-muted max-w-[620px] mb-6 leading-relaxed">
            14 AI agents research every angle, debate each other&apos;s logic, and
            deliver a consensus recommendation with entry/exit zones - in under
            60 seconds.
          </p>

          <p className="text-sm text-muted/70 mb-10 max-w-[520px]">
            Most prediction market traders rely on gut instinct and lose money.
            TradeWizard gives you the same depth of analysis a professional
            trading desk uses - automated, transparent, and always on.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center mb-16 w-full sm:w-auto">
            <Link
              href="/login"
              className="bg-accent text-white font-semibold px-6 sm:px-8 py-3.5 rounded-lg text-base hover:opacity-90 transition-opacity shadow-[0_0_20px_oklch(62%_0.20_260_/_0.3)] text-center"
            >
              Start Free - 20 Credits, No Card
            </Link>
            <a
              href="#how"
              className="bg-surface border border-border text-fg font-medium px-6 sm:px-8 py-3.5 rounded-lg text-base hover:border-muted transition-colors text-center"
            >
              See the Analysis Pipeline
            </a>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-[600px]">
            {STATS.map((stat) => (
              <div key={stat.label}>
                <div className="font-display text-2xl font-bold text-fg">
                  {stat.value}
                </div>
                <div className="text-xs text-muted mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── PRODUCT SCREENSHOT ─── */}
      <section className="w-full px-4 sm:px-6 pb-[clamp(3rem,6vw,5rem)]">
        <div className="max-w-full">
          <BrowserFrame
            src="/designs/market-detail.html"
            title="TradeWizard - AI Analysis Dashboard"
            height={700}
            priority
          />
        </div>
      </section>

      {/* ─── SOCIAL PROOF / TRUST STRIP ─── */}
      <section className="w-full px-4 sm:px-6 py-[clamp(2rem,4vw,3rem)] border-y border-border">
        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-muted text-center mb-6">
            Built on
          </p>
          <div className="flex items-center justify-center text-fg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <svg viewBox="0 0 911 168" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-7 sm:h-9 w-auto" aria-label="Polymarket">
              <path fillRule="evenodd" clipRule="evenodd" d="M395.676 132.183V29.2346H378.683V132.183H395.676ZM228.862 96.1278V132.186H211.188V34.6007H249.334C256.841 34.6007 263.335 35.93 268.817 38.5885C274.299 41.247 278.474 44.9332 281.34 49.6475C284.206 54.3613 285.639 59.7346 285.639 65.7666C285.639 72.0667 284.217 77.4955 281.374 82.053C278.53 86.6104 274.391 90.0957 268.954 92.5088C263.517 94.9218 256.978 96.1278 249.334 96.1278H228.862ZM228.861 82.1873H249.334C255.658 82.1873 260.332 80.7347 263.358 77.8307C266.383 74.9261 267.896 70.9493 267.896 65.9003C267.896 62.7729 267.236 59.9019 265.917 57.2879C264.598 54.674 262.55 52.5741 259.775 50.9878C257 49.4015 253.52 48.6083 249.334 48.6083H228.861V82.1873ZM329.499 133.53C336.551 133.53 342.67 131.944 347.856 128.772C353.043 125.599 357.013 121.22 359.765 115.635C362.517 110.05 363.893 103.727 363.893 96.6673V95.2599C363.893 88.2002 362.517 81.8775 359.765 76.2924C357.013 70.7073 353.032 66.3172 347.823 63.122C342.613 59.9273 336.46 58.33 329.363 58.33C322.357 58.33 316.26 59.9273 311.074 63.122C305.888 66.3172 301.919 70.7073 299.166 76.2924C296.414 81.8775 295.037 88.2002 295.037 95.2599V96.6673C295.037 103.727 296.414 110.05 299.166 115.635C301.919 121.22 305.899 125.599 311.108 128.772C316.317 131.944 322.448 133.53 329.499 133.53ZM316.397 113.559C319.309 117.938 323.676 120.127 329.5 120.127C333.366 120.127 336.608 119.088 339.224 117.01C341.84 114.933 343.774 112.129 345.025 108.599C346.276 105.069 346.901 101.093 346.901 96.6691V95.2617C346.901 90.8825 346.276 86.9173 345.025 83.3649C343.774 79.8125 341.829 76.9866 339.19 74.8862C336.551 72.7863 333.276 71.7361 329.363 71.7361C325.496 71.7361 322.266 72.7863 319.673 74.8862C317.08 76.9866 315.157 79.8125 313.906 83.3649C312.655 86.9173 312.029 90.8825 312.029 95.2617V96.6691C312.029 103.55 313.486 109.18 316.397 113.559ZM435.067 156.07C431.586 159.667 426.616 161.465 420.155 161.465C417.926 161.465 415.22 161.063 412.035 160.259V147.457L415.174 147.592C419.223 147.592 422.305 146.888 424.421 145.48C426.536 144.073 428.208 141.604 429.437 138.074L431.757 131.908L405.825 59.657H424.182L439.536 108.316L454.413 59.657H472.497L443.085 143.168C441.22 148.172 438.547 152.473 435.067 156.07ZM498.752 132.19V79.7777C501.482 74.5498 506.099 71.9359 512.605 71.9359C516.882 71.9359 520.121 72.9635 522.329 75.0188C524.537 77.074 525.641 80.5373 525.641 85.4074V132.19H542.632V83.8662L542.563 82.3245C543.562 79.1519 545.259 76.6277 547.647 74.7507C550.036 72.8743 553.005 71.9359 556.555 71.9359C560.874 71.9359 564.116 72.9079 566.278 74.8514C568.44 76.795 569.521 80.2467 569.521 85.2065V132.19H586.512V85.2737C586.512 75.9347 584.443 69.1094 580.3 64.798C576.162 60.486 570.177 58.33 562.356 58.33C557.392 58.33 553.005 59.3021 549.181 61.2456C545.364 63.1891 542.197 65.9038 539.698 69.3891C537.833 65.6358 535.171 62.8539 531.714 61.0447C528.256 59.2349 524.206 58.33 519.566 58.33C515.016 58.33 510.956 59.1006 507.385 60.6423C503.813 62.1841 500.777 64.4067 498.275 67.3112L497.728 59.6703H481.76V132.19H498.752ZM636.991 131.319C633.76 132.793 630.099 133.53 626.002 133.53C621.179 133.53 616.862 132.592 613.038 130.715C609.215 128.839 606.234 126.247 604.101 122.941C601.963 119.634 600.894 115.925 600.894 111.815C600.894 104.085 603.816 98.1645 609.662 94.0534C615.508 89.9429 623.8 87.8876 634.533 87.8876H644.771V83.1958C644.771 79.3533 643.702 76.348 641.564 74.181C639.425 72.014 636.264 70.9302 632.075 70.9302C629.576 70.9302 627.368 71.3552 625.456 72.2039C623.544 73.0527 622.068 74.2146 621.022 75.6892C619.976 77.1638 619.453 78.8167 619.453 80.649H602.462C602.462 76.7614 603.723 73.1088 606.245 69.6907C608.773 66.2726 612.364 63.5243 617.03 61.4465C621.691 59.3687 627.025 58.33 633.033 58.33C638.676 58.33 643.656 59.2685 647.979 61.1449C652.302 63.0218 655.678 65.8367 658.113 69.59C660.548 73.3433 661.762 77.9233 661.762 83.3295V115.3C661.762 121.913 662.698 127.163 664.563 131.05V132.19H647.229C646.497 130.626 645.864 128.369 645.318 125.421C642.993 127.878 640.222 129.844 636.991 131.319ZM629.28 120.189C625.689 120.189 622.888 119.261 620.889 117.408C618.884 115.553 617.885 113.151 617.885 110.202C617.885 106.404 619.407 103.455 622.458 101.355C625.503 99.2552 629.989 98.205 635.898 98.205H644.771V111.744C643.499 114.067 641.482 116.056 638.734 117.709C635.98 119.362 632.83 120.189 629.28 120.189ZM695.797 82.7934V132.19H678.806V59.6703H694.977L695.454 67.8473C697.319 64.809 699.644 62.4631 702.415 60.8097C705.193 59.1568 708.401 58.33 712.038 58.33C712.997 58.33 714.072 58.4192 715.281 58.5981C716.484 58.777 717.384 58.9779 717.977 59.2013L717.837 74.9516C715.565 74.5944 713.311 74.4155 711.085 74.4155C703.485 74.4155 698.388 77.2083 695.797 82.7934ZM745.183 132.183V108.657L752.627 101.218L774.122 132.183H793.774L763.546 89.8242L790.909 59.6633H770.438L750.239 82.1161L745.183 88.2824V29.2346H728.262V132.183H745.183ZM851.354 129.643C846.577 132.234 840.796 133.53 834.02 133.53C826.832 133.53 820.55 132 815.181 128.939C809.818 125.879 805.698 121.689 802.833 116.372C799.968 111.055 798.533 105.09 798.533 98.4771V95.7289C798.533 88.2674 799.986 81.7102 802.903 76.058C805.814 70.4057 809.818 66.0375 814.908 62.9547C820.004 59.8718 825.74 58.33 832.108 58.33C839.07 58.33 844.916 59.8272 849.646 62.8209C854.376 65.8141 857.914 70.0033 860.256 75.3876C862.598 80.7718 863.772 87.0163 863.772 94.1206V101.158H815.664C815.977 104.866 816.959 108.151 818.598 111.01C820.231 113.87 822.451 116.104 825.252 117.713C828.047 119.322 831.312 120.126 835.043 120.126C842.684 120.126 848.826 117.177 853.469 111.279L862.546 119.925C859.861 123.812 856.131 127.052 851.354 129.643ZM846.984 89.0953H816.001C816.773 83.5993 818.528 79.3325 821.259 76.2942C823.985 73.2553 827.582 71.7361 832.039 71.7361C837.042 71.7361 840.732 73.2443 843.097 76.2606C845.462 79.2763 846.758 83.1304 846.984 87.8222V89.0953ZM910.974 131.921C907.702 132.993 904.018 133.529 899.921 133.529C893.913 133.529 889.183 131.898 885.725 128.636C882.268 125.374 880.542 120.169 880.542 113.02V72.0013H868.531V59.6691H880.542V41.9753H897.533V59.6691H910.497V72.0013H897.533V111.88C897.533 114.919 898.166 116.986 899.445 118.08C900.717 119.175 902.629 119.722 905.174 119.722C906.993 119.722 908.928 119.499 910.974 119.052V131.921Z" fill="currentColor"/><path d="M136.267 152.495C136.267 159.76 136.267 163.392 133.891 165.192C131.516 166.993 128.019 166.012 121.024 164.049L8.63192 132.51C4.41793 131.328 2.31093 130.737 1.09248 129.129C-0.125977 127.522 -0.125977 125.333 -0.125977 120.957V47.0434C-0.125977 42.6667 -0.125977 40.4783 1.09248 38.8709C2.31093 37.2634 4.41792 36.6722 8.63191 35.4897L121.024 3.95096C128.019 1.98834 131.516 1.00703 133.891 2.80771C136.267 4.60839 136.267 8.24049 136.267 15.5047V152.495ZM27.9043 122.228L120.966 148.345V96.1133L27.9043 122.228ZM15.1738 110.111L108.217 84L15.1738 57.8887V110.111ZM27.9033 45.7725L120.966 71.8877V19.6553L27.9033 45.7725Z" fill="currentColor"/></svg>
          </div>
        </div>
      </section>

      {/* ─── PROBLEM → SOLUTION ─── */}
      <section className="w-full px-4 sm:px-6 py-[clamp(4rem,8vw,7rem)]">
        <div>
          <div className="text-center mb-12">
            <p className="text-xs uppercase tracking-[0.1em] text-ai font-semibold mb-3">
              The Problem
            </p>
            <h2 className="font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold tracking-[-0.02em] max-w-[640px] mx-auto">
              Prediction markets reward research depth. Most traders don&apos;t
              have it.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8">
            {/* Before */}
            <div className="bg-surface border border-border rounded-[var(--radius)] p-5 sm:p-8">
              <div className="text-no font-semibold text-sm mb-4 uppercase tracking-wide">
                Without TradeWizard
              </div>
              <ul className="space-y-3 text-[0.9rem] text-muted">
                <li className="flex gap-3">
                  <span className="text-no shrink-0">✕</span>
                  Gut instinct on complex events
                </li>
                <li className="flex gap-3">
                  <span className="text-no shrink-0">✕</span>
                  Hours of manual news research
                </li>
                <li className="flex gap-3">
                  <span className="text-no shrink-0">✕</span>
                  No systematic edge calculation
                </li>
                <li className="flex gap-3">
                  <span className="text-no shrink-0">✕</span>
                  Emotional entries and exits
                </li>
                <li className="flex gap-3">
                  <span className="text-no shrink-0">✕</span>
                  Miss opportunities while sleeping
                </li>
              </ul>
            </div>

            {/* After */}
            <div className="bg-gradient-to-br from-ai/8 to-surface border border-ai/20 rounded-[var(--radius)] p-5 sm:p-8">
              <div className="text-ai font-semibold text-sm mb-4 uppercase tracking-wide">
                With TradeWizard
              </div>
              <ul className="space-y-3 text-[0.9rem] text-muted">
                <li className="flex gap-3">
                  <span className="text-yes shrink-0">✓</span>
                  14 specialized agents analyze every angle
                </li>
                <li className="flex gap-3">
                  <span className="text-yes shrink-0">✓</span>
                  Real-time news, polls, sentiment, price action
                </li>
                <li className="flex gap-3">
                  <span className="text-yes shrink-0">✓</span>
                  Quantified edge with confidence bands
                </li>
                <li className="flex gap-3">
                  <span className="text-yes shrink-0">✓</span>
                  Systematic entry/exit zones + position sizing
                </li>
                <li className="flex gap-3">
                  <span className="text-yes shrink-0">✓</span>
                  Autonomous 24/7 Portfolio Manager
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS (PIPELINE) ─── */}
      <section
        id="how"
        className="w-full px-4 sm:px-6 py-[clamp(4rem,8vw,7rem)]"
      >
        <div>
          <div className="text-center mb-12">
            <p className="text-xs uppercase tracking-[0.1em] text-ai font-semibold mb-3">
              How It Works
            </p>
            <h2 className="font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold tracking-[-0.02em] mb-4 max-w-[640px] mx-auto">
              A full analyst team, compressed into 60 seconds
            </h2>
            <p className="text-muted text-[clamp(0.95rem,1.2vw,1.1rem)] max-w-[560px] mx-auto">
              TradeWizard&apos;s multi-agent debate system mirrors how professional
              trading desks operate - research, challenge, consensus, action.
            </p>
          </div>

          {/* Pipeline visualization */}
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[18px] top-4 bottom-4 w-px bg-gradient-to-b from-accent via-ai to-yes hidden sm:block" />

            <div className="space-y-4">
              {PIPELINE_STAGES.map((stage, i) => (
                <div key={stage.label} className="flex gap-5 items-start">
                  {/* Node dot */}
                  <div className="relative shrink-0 hidden sm:flex">
                    <div className="w-[37px] h-[37px] rounded-full bg-surface-2 border border-border flex items-center justify-center">
                      <span className="font-mono text-[0.65rem] text-accent font-bold">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="bg-surface border border-border rounded-[var(--radius)] p-5 flex-1">
                    <div className="font-semibold text-sm mb-0.5">
                      <span className="sm:hidden font-mono text-accent mr-2">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      {stage.label}
                    </div>
                    <p className="text-[0.8rem] text-muted">{stage.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Agent grid */}
          <div className="mt-14">
            <p className="text-sm text-muted mb-4">
              All 14 agents run on every analysis - no shortcuts:
            </p>
            <div className="flex flex-wrap gap-2">
              {AGENTS.map((agent) => (
                <span
                  key={agent}
                  className="bg-surface-2 border border-border text-[0.72rem] text-muted px-2.5 py-1 rounded-md font-mono"
                >
                  {agent}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── SAMPLE ANALYSIS OUTPUT ─── */}
      <section className="w-full px-4 sm:px-6 py-[clamp(3rem,6vw,5rem)]">
        <div>
          <div className="text-center mb-10">
            <p className="text-xs uppercase tracking-[0.1em] text-ai font-semibold mb-3">
              Real Output
            </p>
            <h2 className="font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold tracking-[-0.02em] mb-4">
              See what you get
            </h2>
            <p className="text-muted text-[clamp(0.95rem,1.2vw,1.1rem)] max-w-[560px] mx-auto">
              Every analysis includes the full reasoning chain - not just a number.
              You see why, not just what.
            </p>
          </div>

          <BrowserFrame
            src="/designs/insights.html"
            title="TradeWizard - Analysis Output"
            height={650}
          />
        </div>
      </section>

      {/* ─── FEATURES (Benefit-Led) ─── */}
      <section
        id="features"
        className="w-full px-4 sm:px-6 py-[clamp(4rem,8vw,7rem)]"
      >
        <div>
          <div className="text-center mb-12">
            <p className="text-xs uppercase tracking-[0.1em] text-ai font-semibold mb-3">
              Capabilities
            </p>
            <h2 className="font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold tracking-[-0.02em] mb-4">
              Everything you need to trade with edge
            </h2>
            <p className="text-muted text-[clamp(0.95rem,1.2vw,1.1rem)] max-w-[560px] mx-auto">
              From research to execution, every piece is designed to give you a
              systematic advantage.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8">
            {/* Feature 1 - Multi-agent */}
            <div className="bg-surface border border-border rounded-[var(--radius)] p-5 sm:p-8">
              <div className="w-10 h-10 rounded-lg bg-[oklch(58%_0.18_295_/_0.12)] flex items-center justify-center text-ai text-lg mb-5">
                🧠
              </div>
              <h3 className="text-lg font-semibold mb-2">
                14 Agents, One Consensus
              </h3>
              <p className="text-[0.9rem] text-muted leading-relaxed mb-4">
                Each agent specializes in a different methodology - momentum,
                sentiment, polling, tail risk, event impact, and more. They
                argue, and the system extracts signal from disagreement.
              </p>
              <p className="text-[0.8rem] text-accent font-medium">
                Full reasoning chain visible for every recommendation
              </p>
            </div>

            {/* Feature 2 - Recurring */}
            <div className="bg-surface border border-border rounded-[var(--radius)] p-5 sm:p-8">
              <div className="w-10 h-10 rounded-lg bg-[oklch(62%_0.20_260_/_0.12)] flex items-center justify-center text-accent text-lg mb-5">
                🔄
              </div>
              <h3 className="text-lg font-semibold mb-2">
                Set It and Forget It
              </h3>
              <p className="text-[0.9rem] text-muted leading-relaxed mb-4">
                Schedule recurring analysis at 1-hour to daily intervals. Get
                notified the instant the AI detects a meaningful probability
                shift on your markets.
              </p>
              <p className="text-[0.8rem] text-accent font-medium">
                Multi-channel: in-app, email, push, webhook
              </p>
            </div>

            {/* Feature 3 - Portfolio Manager */}
            <div className="bg-gradient-to-br from-ai/8 to-surface border border-ai/20 rounded-[var(--radius)] p-5 sm:p-8">
              <div className="w-10 h-10 rounded-lg bg-[oklch(58%_0.18_295_/_0.12)] flex items-center justify-center text-ai text-lg mb-5">
                🤖
              </div>
              <h3 className="text-lg font-semibold mb-2">
                Autonomous Portfolio Manager
              </h3>
              <p className="text-[0.9rem] text-muted leading-relaxed mb-4">
                Deploy AI traders that enter, monitor, and exit positions 24/7.
                Choose from 6 trading personas - each with distinct risk
                appetite and strategy logic.
              </p>
              <ul className="space-y-1.5 text-[0.8rem] text-muted">
                <li className="flex gap-2">
                  <span className="text-yes">✓</span> Mandatory stop-loss &
                  take-profit on every trade
                </li>
                <li className="flex gap-2">
                  <span className="text-yes">✓</span> Progressive loss limits +
                  kill switch
                </li>
                <li className="flex gap-2">
                  <span className="text-yes">✓</span> Full transparency -
                  see every decision and why
                </li>
              </ul>
            </div>

            {/* Feature 4 - Risk */}
            <div className="bg-surface border border-border rounded-[var(--radius)] p-5 sm:p-8">
              <div className="w-10 h-10 rounded-lg bg-[oklch(72%_0.16_155_/_0.12)] flex items-center justify-center text-yes text-lg mb-5">
                🛡️
              </div>
              <h3 className="text-lg font-semibold mb-2">
                Risk-First Architecture
              </h3>
              <p className="text-[0.9rem] text-muted leading-relaxed mb-4">
                Three risk philosophy agents (aggressive, conservative, neutral)
                size every position independently. The system refuses to
                recommend when consensus fails (&gt;30% disagreement).
              </p>
              <p className="text-[0.8rem] text-accent font-medium">
                Negative EV → automatic NO_TRADE, even with an edge
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── PORTFOLIO MANAGER SCREENSHOT ─── */}
      <section className="w-full px-4 sm:px-6 py-[clamp(3rem,6vw,5rem)]">
        <div>
          <div className="text-center mb-10">
            <p className="text-xs uppercase tracking-[0.1em] text-ai font-semibold mb-3">
              Autonomous Trading
            </p>
            <h2 className="font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold tracking-[-0.02em] mb-4">
              Deploy your AI trader. Sleep while it works.
            </h2>
            <p className="text-muted text-[clamp(0.95rem,1.2vw,1.1rem)] max-w-[560px] mx-auto">
              The Portfolio Manager consumes your recurring analysis results and
              autonomously executes - entering, monitoring, and exiting positions
              with your chosen persona&apos;s strategy.
            </p>
          </div>

          <BrowserFrame
            src="/designs/portfolio-manager.html"
            title="TradeWizard - Portfolio Manager"
            height={650}
          />

          {/* Persona pills */}
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            {[
              "Sniper",
              "Scalper",
              "Contrarian",
              "Catalyst Hunter",
              "Hedge Architect",
              "Momentum Rider",
            ].map((persona) => (
              <span
                key={persona}
                className="bg-surface-2 border border-border text-[0.8rem] text-muted px-3 py-1.5 rounded-lg"
              >
                {persona}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ─── PRICING ─── */}
      <section
        id="pricing"
        className="w-full px-4 sm:px-6 py-[clamp(4rem,8vw,7rem)]"
      >
        <div>
          <div className="text-center mb-12">
            <p className="text-xs uppercase tracking-[0.1em] text-ai font-semibold mb-3">
              Pricing
            </p>
            <h2 className="font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold tracking-[-0.02em] mb-4">
              Start free. Pay only for what you use.
            </h2>
            <p className="text-muted text-[clamp(0.95rem,1.2vw,1.1rem)] max-w-[560px] mx-auto">
              Every plan includes full analysis depth - all 14 agents, all 11
              stages. Credits unlock more markets and frequency, not quality.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative bg-surface border rounded-[var(--radius)] p-5 sm:p-7 flex flex-col ${
                  plan.featured ? "border-accent shadow-[0_0_24px_oklch(62%_0.20_260_/_0.15)]" : "border-border"
                }`}
              >
                {plan.featured && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-accent text-white text-[0.65rem] font-bold px-3 py-0.5 rounded-full uppercase tracking-[0.05em]">
                    Most Popular
                  </span>
                )}
                <div className="text-[0.85rem] text-muted mb-1">
                  {plan.name}
                </div>
                <div className="font-display text-[2rem] font-bold mb-1">
                  {plan.price}
                  {plan.period && (
                    <span className="text-sm font-normal text-muted">
                      {plan.period}
                    </span>
                  )}
                </div>
                <div className="text-[0.8rem] text-accent font-mono mb-5">
                  {plan.credits}
                </div>
                {plan.trial && (
                  <div className="inline-flex items-center gap-1.5 bg-[oklch(72%_0.16_155_/_0.1)] border border-[oklch(72%_0.16_155_/_0.25)] text-[oklch(72%_0.16_155)] text-[0.7rem] font-semibold px-2.5 py-1 rounded-md mb-4 w-fit">
                    <span>✦</span> 30-day free trial
                  </div>
                )}
                <ul className="flex flex-col gap-2.5 mb-7 flex-1">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="text-[0.82rem] text-muted pl-5 relative before:content-['✓'] before:absolute before:left-0 before:text-yes before:text-[0.75rem]"
                    >
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  href={plan.trial ? "/login?next=/account/subscription" : "/login"}
                  className={`block text-center py-2.5 rounded-lg text-[0.85rem] font-semibold transition-all ${
                    plan.trial
                      ? "bg-gradient-to-r from-[oklch(58%_0.18_295)] to-[oklch(62%_0.20_260)] text-white border border-transparent hover:opacity-90 shadow-[0_2px_12px_oklch(58%_0.18_295_/_0.3)]"
                      : plan.featured
                      ? "bg-accent text-white border border-accent hover:opacity-90"
                      : "border border-border text-fg hover:border-muted"
                  }`}
                >
                  {plan.trial
                    ? "Start Free Trial"
                    : plan.name === "Free"
                    ? "Get Started Free"
                    : "Subscribe"}
                </Link>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-muted mt-8">
            All payments are settled on-chain. No credit card needed.
            Cancel anytime.
          </p>
        </div>
      </section>

      {/* ─── FAQ / OBJECTION HANDLING ─── */}
      <section className="w-full px-4 sm:px-6 py-[clamp(4rem,8vw,7rem)]">
        <div className="max-w-[800px] mx-auto">
          <p className="text-xs uppercase tracking-[0.1em] text-ai font-semibold mb-3">
            Questions
          </p>
          <h2 className="font-display text-[clamp(1.75rem,3.5vw,2.5rem)] font-bold tracking-[-0.02em] mb-10">
            Common questions
          </h2>

          <div className="space-y-4">
            <details className="group bg-surface border border-border rounded-[var(--radius)] overflow-hidden">
              <summary className="flex justify-between items-center p-5 cursor-pointer text-[0.9rem] font-medium hover:text-accent transition-colors">
                Is this actually better than my own research?
                <span className="text-muted group-open:rotate-45 transition-transform text-lg">+</span>
              </summary>
              <div className="px-5 pb-5 text-[0.85rem] text-muted leading-relaxed">
                TradeWizard runs 14 specialized agents simultaneously - covering
                momentum, sentiment, polling, microstructure, tail risk, news
                impact, and more. Each agent operates independently, then they
                cross-examine each other&apos;s conclusions. The system surfaces
                disagreements and refuses to recommend when uncertainty is too
                high. It&apos;s not replacing your judgment - it&apos;s giving you
                a structured, multi-angle research brief in 60 seconds that would
                take hours manually.
              </div>
            </details>

            <details className="group bg-surface border border-border rounded-[var(--radius)] overflow-hidden">
              <summary className="flex justify-between items-center p-5 cursor-pointer text-[0.9rem] font-medium hover:text-accent transition-colors">
                What if the AI is wrong?
                <span className="text-muted group-open:rotate-45 transition-transform text-lg">+</span>
              </summary>
              <div className="px-5 pb-5 text-[0.85rem] text-muted leading-relaxed">
                The system is designed for intellectual honesty. When agents
                disagree by more than 30%, the consensus engine explicitly fails
                and returns NO_TRADE. Even when there&apos;s an edge, if expected
                value is negative after accounting for liquidity and fees, the
                recommendation is NO_TRADE. You always see the full reasoning
                chain - confidence levels, disagreement metrics, and risk factors
                - so you can evaluate the logic yourself.
              </div>
            </details>

            <details className="group bg-surface border border-border rounded-[var(--radius)] overflow-hidden">
              <summary className="flex justify-between items-center p-5 cursor-pointer text-[0.9rem] font-medium hover:text-accent transition-colors">
                How does the Portfolio Manager protect my capital?
                <span className="text-muted group-open:rotate-45 transition-transform text-lg">+</span>
              </summary>
              <div className="px-5 pb-5 text-[0.85rem] text-muted leading-relaxed">
                Multiple layers: every trade has a mandatory stop-loss and
                take-profit set by the AI (not optional). Sessions have a 50%
                loss limit - if hit, the session pauses automatically. A global
                Kill Switch exits all positions across all markets immediately.
                30-minute cooldowns prevent revenge trading. Position sizes are
                capped at 50% of session capital. The system is conservative by
                design - it fails closed.
              </div>
            </details>

            <details className="group bg-surface border border-border rounded-[var(--radius)] overflow-hidden">
              <summary className="flex justify-between items-center p-5 cursor-pointer text-[0.9rem] font-medium hover:text-accent transition-colors">
                What do I pay with?
                <span className="text-muted group-open:rotate-45 transition-transform text-lg">+</span>
              </summary>
              <div className="px-5 pb-5 text-[0.85rem] text-muted leading-relaxed">
                All payments are settled on-chain - no credit card,
                no bank account needed. You approve a transfer for your plan,
                and auto-renewal uses a pre-approved ERC-20 allowance. Cancel
                anytime and your access continues until the billing period ends.
                You can also buy credit packs for one-off top-ups.
              </div>
            </details>

            <details className="group bg-surface border border-border rounded-[var(--radius)] overflow-hidden">
              <summary className="flex justify-between items-center p-5 cursor-pointer text-[0.9rem] font-medium hover:text-accent transition-colors">
                Can I try it before paying?
                <span className="text-muted group-open:rotate-45 transition-transform text-lg">+</span>
              </summary>
              <div className="px-5 pb-5 text-[0.85rem] text-muted leading-relaxed">
                Yes. Starter and Pro plans both offer a 30-day free trial -
                full access to all features of that plan with no payment
                required upfront. After 30 days, you can choose to subscribe
                or you&apos;ll be moved back to the Free plan. And the Free plan
                itself includes 20 credits per month with full analysis depth -
                all 14 agents, all 11 stages - no time limit.
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA ─── */}
      <section className="w-full px-4 sm:px-6 py-[clamp(5rem,10vw,8rem)]">
        <div className="text-center">
          <h2 className="font-display text-[clamp(1.75rem,4vw,3rem)] font-bold tracking-[-0.02em] mb-4">
            Your edge is waiting.
          </h2>
          <p className="text-muted text-[clamp(1rem,1.3vw,1.15rem)] max-w-[480px] mx-auto mb-10">
            20 free credits. Full analysis depth. No card required.
            See what 14 AI agents find on your next trade.
          </p>
          <Link
            href="/login"
            className="inline-block bg-accent text-white font-semibold px-8 sm:px-10 py-3.5 sm:py-4 rounded-lg text-base sm:text-lg hover:opacity-90 transition-opacity shadow-[0_0_30px_oklch(62%_0.20_260_/_0.25)]"
          >
            Start Free
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
