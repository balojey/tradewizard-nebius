"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { logError } from "@/utils/errorLogging";

export default function QueryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Default staleTime for general queries (10 seconds)
            staleTime: 10000,
            // Default gcTime for garbage collection (30 minutes)
            gcTime: 30 * 60 * 1000,
            // Disable refetchOnWindowFocus by default (can be overridden per query)
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Don't retry on 4xx errors (client errors)
              if (error instanceof Error && error.message.includes("40")) {
                return false;
              }
              // Retry up to 2 times for other errors
              return failureCount < 2;
            },
            retryDelay: (attemptIndex) => {
              // Exponential backoff: 1s, 2s, 4s
              return Math.min(1000 * 2 ** attemptIndex, 30000);
            },
          },
          mutations: {
            retry: false, // Don't retry mutations by default
            onError: (error) => {
              // Log mutation errors
              logError(error, {
                component: "QueryClient",
                action: "mutation",
              });
            },
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
