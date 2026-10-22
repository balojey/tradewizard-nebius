export const TL = {
  fadeInEnd: 18,
  cursorIn: { from: 22, to: 48 },
  clickGet: 52,
  modalOpen: 56,
  cursorToRequest: { from: 72, to: 100 },
  clickRequest: 105,
  progressStart: 114,
  progressEnd: 250,
  complete: 252,
  modalClose: 266,
  verdictStart: 270,
  verdictStats: 300,
  hold: 398,
  fadeOut: 404,
  total: 420,
} as const;

export const STAGES = [
  "Market ingestion",
  "Memory retrieval",
  "Web research",
  "Agent selection",
  "Intelligence agents",
  "Signal fusion",
  "Thesis construction",
  "Cross-examination",
  "Consensus engine",
  "Risk philosophy",
  "Recommendation",
] as const;

export const AGENTS = [
  "Microstructure",
  "Probability",
  "Risk",
  "Breaking news",
  "Event impact",
  "Polling",
  "Historical",
  "Media",
  "Social",
  "Narrative",
  "Momentum",
  "Mean reversion",
  "Catalyst",
  "Tail risk",
] as const;

export const CURSOR_GET = { x: 568, y: 750 };
export const CURSOR_REQUEST = { x: 1004, y: 806 };
