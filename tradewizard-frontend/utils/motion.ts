import type { Variants, Transition } from 'framer-motion'

// ---------------------------------------------------------------------------
// Duration tokens (seconds - Framer Motion's native unit)
// ---------------------------------------------------------------------------

export const duration = {
  fast: 0.15,
  base: 0.2,
  slow: 0.4,
} as const

// ---------------------------------------------------------------------------
// Easing curves
// ---------------------------------------------------------------------------

export const ease = {
  /** Material-style standard curve - quick deceleration. */
  standard: [0.4, 0, 0.2, 1] as const,
  /** Emphasized curve - snappier exit. */
  emphasized: [0.4, 0, 0, 1] as const,
  /** Ease-out for enter animations. */
  out: [0, 0, 0.2, 1] as const,
  /** Ease-in-out for symmetric transitions. */
  inOut: [0.4, 0, 0.2, 1] as const,
  /** Spring-like bounce for interactive feedback. */
  spring: { type: 'spring', stiffness: 400, damping: 30 } as const,
} as const

// ---------------------------------------------------------------------------
// Common Framer Motion variants
// ---------------------------------------------------------------------------

export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: duration.base, ease: ease.standard } },
  exit: { opacity: 0, transition: { duration: duration.fast, ease: ease.standard } },
}

export const slideUp: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.base, ease: ease.standard },
  },
  exit: {
    opacity: 0,
    y: 8,
    transition: { duration: duration.fast, ease: ease.standard },
  },
}

export const pulseAi: Variants = {
  initial: { scale: 1, opacity: 0.7 },
  animate: {
    scale: [1, 1.15, 1],
    opacity: [0.7, 1, 0.7],
    transition: {
      duration: 2,
      ease: 'easeInOut',
      repeat: Infinity,
      repeatType: 'loop',
    },
  },
}

// ---------------------------------------------------------------------------
// Reduced-motion helper
// ---------------------------------------------------------------------------

/**
 * Returns an instant (zero-duration) transition when the user prefers reduced
 * motion. Use this to override any decorative animation at the call site:
 *
 * ```tsx
 * const prefersReduced = useReducedMotion()
 * <motion.div variants={fadeIn} {...reducedMotionProps(prefersReduced)} />
 * ```
 */
export function reducedMotionProps(prefersReduced: boolean | null) {
  if (!prefersReduced) return {}
  return {
    initial: false as const,
    animate: undefined,
    transition: { duration: 0 } satisfies Transition,
  }
}

/**
 * Returns a transition object that respects reduced-motion preference.
 * When reduced motion is preferred, returns an instant transition.
 */
export function getTransition(
  prefersReduced: boolean | null,
  transition: Transition = { duration: duration.base, ease: ease.standard }
): Transition {
  if (prefersReduced) return { duration: 0 }
  return transition
}

// ---------------------------------------------------------------------------
// Convenience: all motion tokens bundled for import as a single object
// ---------------------------------------------------------------------------

export const motionTokens = {
  duration,
  ease,
  fadeIn,
  slideUp,
  pulseAi,
} as const
