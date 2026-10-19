'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Persona custom parameters (Elite-only customization).
 * Requirements: 3.4, 3.6
 */
export interface PersonaCustomParams {
  exitSensitivity?: number; // 1-5
  monitoringFrequencyMinutes?: number; // 5-60
  positionSizingMultiplier?: number; // 0.5-2.0
}

/**
 * Full persona configuration as returned by the API.
 */
export interface PersonaConfig {
  id: string;
  name: string;
  riskLevel: 'conservative' | 'moderate' | 'aggressive';
  entryRules: {
    minEdge: number;
    minSignalAlignment: number;
    minConvictionScore: number;
    additionalCriteria?: Record<string, unknown>;
  };
  sizingRules: {
    minAllocationPct: number;
    maxAllocationPct: number;
    scalingFactor: number;
  };
  exitRules: {
    patienceWindowMinutes: number;
  };
  monitoringRules: {
    analysisIntervalMinutes: number;
    positionGuardIntervalMinutes: number;
  };
}

/**
 * Persona description object as returned by the API.
 */
export interface PersonaDescription {
  id: string;
  name: string;
  riskLevel: string;
  tagline: string;
  entryPhilosophy: string;
  monitoringStyle: string;
  exitBehavior: string;
}

/**
 * Response from GET /portfolio/settings/persona.
 * Requirements: 3.1, 3.3, 3.4, 3.7
 */
export interface PersonaSettingsResponse {
  personaId: string;
  persona: PersonaConfig;
  description: PersonaDescription | null;
  customParams: PersonaCustomParams | null;
  canCustomize: boolean;
  effectivePersona: PersonaConfig | null;
}

/**
 * Request body for PUT /portfolio/settings/persona.
 * Requirements: 3.1, 3.2, 3.4
 */
export interface UpdatePersonaRequest {
  personaId: string;
  customParams?: PersonaCustomParams;
}

/**
 * Hook to fetch the current persona configuration.
 *
 * Returns the user's selected persona, its full config, description,
 * any Elite custom params, and whether customization is available.
 *
 * Requirements: 3.1, 3.3, 3.7
 */
export function usePersonaSettings() {
  const { isAuthenticated } = useAuth();

  return useQuery<PersonaSettingsResponse>({
    queryKey: ['personaSettings'],
    queryFn: () =>
      apiClient.get<PersonaSettingsResponse>('/portfolio/settings/persona'),
    staleTime: 60_000,
    retry: 2,
    enabled: isAuthenticated,
  });
}

/**
 * Mutation hook to update the user's persona selection.
 *
 * Applies the new persona to all future activations without affecting
 * currently active sessions.
 *
 * Requirements: 3.1, 3.2, 3.4, 3.5
 */
export function useUpdatePersonaSelection() {
  const queryClient = useQueryClient();

  return useMutation<PersonaSettingsResponse, Error, UpdatePersonaRequest>({
    mutationFn: (request) =>
      apiClient.put<PersonaSettingsResponse>(
        '/portfolio/settings/persona',
        request
      ),
    onSuccess: () => {
      // Invalidate all persona and portfolio-related queries so the new
      // selection propagates immediately across the entire UI
      queryClient.invalidateQueries({ queryKey: ['personaSettings'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-session'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-stats'] });
    },
  });
}
