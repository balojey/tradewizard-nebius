'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { PersonaCustomParams, PersonaSettingsResponse } from './usePersonaSettings';

/**
 * Validation ranges for Elite persona customization parameters.
 * Requirements: 3.4, 3.6
 */
export const PERSONA_PARAM_RANGES = {
  exitSensitivity: { min: 1, max: 5, step: 1 },
  monitoringFrequencyMinutes: { min: 5, max: 60, step: 5 },
  positionSizingMultiplier: { min: 0.5, max: 2.0, step: 0.1 },
} as const;

/**
 * Validation error for a single parameter.
 */
export interface ParamValidationError {
  param: string;
  message: string;
  min: number;
  max: number;
}

/**
 * Validates Elite persona customization parameters against allowed ranges.
 *
 * Returns an array of validation errors. Empty array means all params are valid.
 *
 * Requirements: 3.6
 */
export function validatePersonaParams(
  params: PersonaCustomParams
): ParamValidationError[] {
  const errors: ParamValidationError[] = [];

  if (params.exitSensitivity !== undefined) {
    const { min, max } = PERSONA_PARAM_RANGES.exitSensitivity;
    if (
      !Number.isInteger(params.exitSensitivity) ||
      params.exitSensitivity < min ||
      params.exitSensitivity > max
    ) {
      errors.push({
        param: 'exitSensitivity',
        message: `Exit sensitivity must be an integer between ${min} and ${max}`,
        min,
        max,
      });
    }
  }

  if (params.monitoringFrequencyMinutes !== undefined) {
    const { min, max } = PERSONA_PARAM_RANGES.monitoringFrequencyMinutes;
    if (
      !Number.isInteger(params.monitoringFrequencyMinutes) ||
      params.monitoringFrequencyMinutes < min ||
      params.monitoringFrequencyMinutes > max
    ) {
      errors.push({
        param: 'monitoringFrequencyMinutes',
        message: `Monitoring frequency must be an integer between ${min} and ${max} minutes`,
        min,
        max,
      });
    }
  }

  if (params.positionSizingMultiplier !== undefined) {
    const { min, max } = PERSONA_PARAM_RANGES.positionSizingMultiplier;
    if (
      params.positionSizingMultiplier < min ||
      params.positionSizingMultiplier > max
    ) {
      errors.push({
        param: 'positionSizingMultiplier',
        message: `Position sizing multiplier must be between ${min}x and ${max}x`,
        min,
        max,
      });
    }
  }

  return errors;
}

/**
 * Mutation hook to update Elite persona customization parameters with validation.
 *
 * Validates parameters client-side before sending to the API.
 * Throws an error with validation details if params are out of range.
 *
 * Requirements: 3.4, 3.6, 3.7
 */
export function useUpdatePersonaParams() {
  const queryClient = useQueryClient();

  return useMutation<PersonaSettingsResponse, Error, PersonaCustomParams>({
    mutationFn: async (params) => {
      // Client-side validation before API call
      const errors = validatePersonaParams(params);
      if (errors.length > 0) {
        const messages = errors
          .map((e) => `${e.param}: ${e.message}`)
          .join('; ');
        throw new Error(`Validation failed: ${messages}`);
      }

      return apiClient.put<PersonaSettingsResponse>(
        '/portfolio/settings/persona',
        { customParams: params }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personaSettings'] });
    },
  });
}
