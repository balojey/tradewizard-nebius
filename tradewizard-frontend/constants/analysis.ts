export const PIPELINE_STAGES = [
  {
    label: "Data Collection",
    detail: "Price history, related markets, web research",
  },
  {
    label: "14 Intelligence Agents",
    detail: "Parallel analysis from 14 methodologies",
  },
  {
    label: "Signal Fusion",
    detail: "Weighted aggregation + conflict detection",
  },
  {
    label: "Thesis Construction",
    detail: "Competing bull & bear cases",
  },
  {
    label: "Cross-Examination",
    detail: "5 adversarial stress tests",
  },
  {
    label: "Consensus Engine",
    detail: "Final probability + confidence band",
  },
  {
    label: "Recommendation",
    detail: "Entry/exit zones, sizing, risk factors",
  },
] as const;

export const AGENTS = [
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
