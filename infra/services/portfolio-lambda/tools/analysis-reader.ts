/**
 * read_full_analysis Strands tool - reads full analysis result from S3.
 *
 * Read-only tool: no state mutation or order placement.
 *
 * Requirements: 2.4, 3.5
 */

import { tool } from '@strands-agents/sdk';
import type { JSONValue } from '@strands-agents/sdk';
import { z } from 'zod';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({});

const BUCKET = process.env.ANALYSIS_RESULTS_BUCKET || '';

/**
 * Strands tool: read_full_analysis
 *
 * Reads the full analysis result JSON from S3 for a given analysis ID.
 * This provides the complete analysis context including agent signals,
 * thesis construction, cross-examination scores, and risk perspectives.
 */
export const readFullAnalysisTool = tool({
  name: 'read_full_analysis',
  description:
    'Read the full analysis result from storage by analysis ID. Returns the complete analysis including agent signals, theses, cross-examination scores, risk perspectives, and the final recommendation. Use this to understand the full context behind the analysis that triggered this decision.',
  inputSchema: z.object({
    analysisResultId: z.string().describe('The analysis result UUID to retrieve'),
  }),
  callback: async (input): Promise<JSONValue> => {
    try {
      if (!BUCKET) {
        return {
          error: true,
          toolName: 'read_full_analysis',
          message: 'ANALYSIS_RESULTS_BUCKET not configured',
        };
      }

      // Try to read the full detail first (includes agent signals, theses, cross-exam)
      // The orchestrator stores detail under detail/{marketId}/{requestId}.json
      // and the public result under results/{marketId}/{requestId}.json
      // We try both: detail key first (has agent signals), then public result as fallback
      let analysisData: Record<string, JSONValue> | null = null;

      // First try the detail path (contains full agent signals, theses, cross-exam)
      const detailKey = `detail/${input.analysisResultId}.json`;
      try {
        const detailResponse = await s3Client.send(
          new GetObjectCommand({ Bucket: BUCKET, Key: detailKey })
        );
        if (detailResponse.Body) {
          const detailText = await detailResponse.Body.transformToString('utf-8');
          analysisData = JSON.parse(detailText) as Record<string, JSONValue>;
        }
      } catch {
        // Detail key not found - fall through to public result
      }

      // Fallback: read the public result (has recommendation but not agent signals)
      if (!analysisData) {
        const resultKey = `results/${input.analysisResultId}.json`;
        const resultResponse = await s3Client.send(
          new GetObjectCommand({ Bucket: BUCKET, Key: resultKey })
        );
        if (!resultResponse.Body) {
          return {
            error: true,
            toolName: 'read_full_analysis',
            message: `No content found for analysis ${input.analysisResultId}`,
          };
        }
        const resultText = await resultResponse.Body.transformToString('utf-8');
        analysisData = JSON.parse(resultText) as Record<string, JSONValue>;
      }

      // Return structured data useful for portfolio decision-making
      return {
        analysisResultId: input.analysisResultId,
        marketId: analysisData.marketId ?? null,
        action: analysisData.action ?? null,
        entryZone: analysisData.entryZone ?? null,
        targetZone: analysisData.targetZone ?? null,
        stopLoss: analysisData.stopLoss ?? null,
        expectedValue: analysisData.expectedValue ?? null,
        winProbability: analysisData.winProbability ?? null,
        liquidityRisk: analysisData.liquidityRisk ?? null,
        explanation: analysisData.explanation ?? null,
        metadata: analysisData.metadata ?? null,
        // Full analysis detail (agent signals, theses, cross-exam, consensus)
        agentSignals: analysisData.agentSignals ?? null,
        fusedSignal: analysisData.fusedSignal ?? null,
        bullThesis: analysisData.bullThesis ?? null,
        bearThesis: analysisData.bearThesis ?? null,
        crossExamination: analysisData.crossExamination ?? null,
        consensus: analysisData.consensus ?? null,
        riskPerspectives: analysisData.riskPerspectives ?? null,
        webResearchSummary: analysisData.webResearchSummary ?? null,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      // Handle specific S3 errors gracefully
      if (message.includes('NoSuchKey') || message.includes('not found')) {
        return {
          error: true,
          toolName: 'read_full_analysis',
          message: `Analysis result ${input.analysisResultId} not found in storage`,
        };
      }

      return {
        error: true,
        toolName: 'read_full_analysis',
        message: `Failed to read analysis: ${message}`,
      };
    }
  },
});
