# TradeWizard - Brand Spec

> Derived from Polymarket + Kalshi visual language, layered with TradeWizard's AI-intelligence identity.

## Visual System Summary

Dark-mode prediction market interface with a deep navy-charcoal canvas, crisp white text, and a signature electric blue primary action color. AI intelligence moments use a secondary violet-indigo glow to differentiate TradeWizard's unique value from standard market chrome. Green/red for directional signals (YES/NO, profit/loss).

## Color Tokens (OKLch)

```css
:root {
  --bg:        oklch(14% 0.015 260);    /* Deep navy-charcoal canvas */
  --surface:   oklch(19% 0.012 260);    /* Card/panel surface */
  --surface-2: oklch(24% 0.010 260);    /* Elevated surface (modals, hover) */
  --fg:        oklch(97% 0.005 260);    /* Primary text - near white */
  --muted:     oklch(62% 0.012 260);    /* Secondary text */
  --border:    oklch(30% 0.010 260);    /* Subtle borders */
  --accent:    oklch(62% 0.20 260);     /* Primary action - electric blue */
  --ai:        oklch(58% 0.18 295);     /* AI/intelligence moments - violet */
  --yes:       oklch(72% 0.16 155);     /* Positive/YES/profit - green */
  --no:        oklch(65% 0.18 25);      /* Negative/NO/loss - coral-red */
  --warning:   oklch(78% 0.14 85);      /* Caution/amber */
}
```

## Typography

- **Display**: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', system-ui, sans-serif
- **Body**: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif
- **Mono**: 'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, monospace

## Posture Rules

1. Dark mode is default - trading/finance users expect it
2. Hairline borders (1px, --border), no heavy shadows
3. Cards: 12px radius, subtle surface elevation, no decorative borders
4. Probability bars and percentages in tabular-nums mono
5. AI-specific elements get a subtle violet glow/gradient accent
6. Green = YES/profit/bullish, Red = NO/loss/bearish - never reversed
7. Dense information layout - respect power users' need for data
8. Progressive disclosure: summary cards → expandable detail panels
9. One accent (blue) for actions, one secondary (violet) for AI - no more
10. No warm beige/cream backgrounds, no emoji icons, no decorative illustrations
