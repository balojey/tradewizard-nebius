export const CARD_STYLES =
  "bg-white/5 backdrop-blur-xl rounded-xl border border-white/10 shadow-2xl ring-1 ring-white/5 transition-all duration-300 hover:bg-white/10 hover:border-white/20 hover:ring-white/10" as const;

export const CONTAINER_STYLES = "w-full px-4 sm:px-6 py-8" as const;

export const BUTTON_BASE = "inline-flex items-center justify-center rounded-lg font-semibold transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer" as const;

export const BUTTON_VARIANTS = {
  primary: "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 active:bg-indigo-700",
  secondary: "bg-white/10 hover:bg-white/20 text-white border border-white/5 backdrop-blur-sm",
  ghost: "hover:bg-white/5 text-gray-300 hover:text-white",
  outline: "border border-white/20 hover:bg-white/5 text-white"
} as const;

export const LOADING_STYLES = "animate-pulse text-indigo-400" as const;

export const ERROR_STYLES =
  "bg-red-500/10 backdrop-blur-md rounded-xl p-6 border border-red-500/20 shadow-lg shadow-red-900/10" as const;

export const SUCCESS_STYLES =
  "bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-green-400" as const;

export const WARNING_STYLES =
  "bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 text-yellow-400" as const;
