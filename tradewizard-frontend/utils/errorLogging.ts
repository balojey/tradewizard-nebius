/**
 * Error Logging Utility
 * 
 * Provides centralized error logging for debugging and monitoring.
 * Logs to console in development and can integrate with error tracking services.
 */

export interface ErrorContext {
  component?: string;
  action?: string;
  userId?: string;
  marketId?: string;
  [key: string]: any;
}

export interface ErrorLog {
  timestamp: string;
  message: string;
  error: Error | unknown;
  context?: ErrorContext;
  stack?: string;
}

/**
 * Log an error with context information
 * 
 * @param error - The error object or message
 * @param context - Additional context about where/why the error occurred
 * 
 * @example
 * ```ts
 * try {
 *   await fetchMarketData(marketId);
 * } catch (error) {
 *   logError(error, {
 *     component: 'MarketDetails',
 *     action: 'fetchMarketData',
 *     marketId
 *   });
 * }
 * ```
 */
export function logError(error: Error | unknown, context?: ErrorContext): void {
  const errorLog: ErrorLog = {
    timestamp: new Date().toISOString(),
    message: error instanceof Error ? error.message : String(error),
    error,
    context,
    stack: error instanceof Error ? error.stack : undefined,
  };

  // Log to console in development
  if (process.env.NODE_ENV === "development") {
    console.error("🔴 Error logged:", errorLog);
  } else {
    // In production, log less verbose info
    console.error("Error:", errorLog.message, context);
  }

  // Send to error tracking service if available (e.g., Sentry)
  if (typeof window !== "undefined" && (window as any).Sentry) {
    (window as any).Sentry.captureException(error, {
      contexts: {
        custom: context,
      },
    });
  }

  // Store in localStorage for debugging (keep last 50 errors)
  if (typeof window !== "undefined") {
    try {
      const storedErrors = JSON.parse(
        localStorage.getItem("errorLogs") || "[]"
      );
      storedErrors.push(errorLog);
      
      // Keep only last 50 errors
      const recentErrors = storedErrors.slice(-50);
      localStorage.setItem("errorLogs", JSON.stringify(recentErrors));
    } catch (storageError) {
      // Ignore localStorage errors
      console.warn("Failed to store error log:", storageError);
    }
  }
}

/**
 * Log a warning (non-critical error)
 * 
 * @param message - Warning message
 * @param context - Additional context
 */
export function logWarning(message: string, context?: ErrorContext): void {
  const warningLog = {
    timestamp: new Date().toISOString(),
    message,
    context,
    level: "warning",
  };

  if (process.env.NODE_ENV === "development") {
    console.warn("⚠️ Warning:", warningLog);
  }
}

/**
 * Get stored error logs from localStorage
 * Useful for debugging or displaying error history to users
 */
export function getErrorLogs(): ErrorLog[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    return JSON.parse(localStorage.getItem("errorLogs") || "[]");
  } catch {
    return [];
  }
}

/**
 * Clear stored error logs
 */
export function clearErrorLogs(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem("errorLogs");
  }
}

/**
 * Format error for display to users
 * Sanitizes technical details and provides user-friendly messages
 */
export function formatErrorForDisplay(error: Error | unknown): string {
  if (error instanceof Error) {
    // Map common error messages to user-friendly versions
    const message = error.message.toLowerCase();
    
    if (message.includes("network") || message.includes("fetch")) {
      return "Network error. Please check your connection and try again.";
    }
    
    if (message.includes("timeout")) {
      return "Request timed out. Please try again.";
    }
    
    if (message.includes("unauthorized") || message.includes("401")) {
      return "Authentication required. Please log in again.";
    }
    
    if (message.includes("forbidden") || message.includes("403")) {
      return "You don't have permission to access this resource.";
    }
    
    if (message.includes("not found") || message.includes("404")) {
      return "The requested resource was not found.";
    }
    
    if (message.includes("500") || message.includes("server error")) {
      return "Server error. Please try again later.";
    }
    
    // Return original message if no mapping found
    return error.message;
  }
  
  return "An unexpected error occurred. Please try again.";
}
