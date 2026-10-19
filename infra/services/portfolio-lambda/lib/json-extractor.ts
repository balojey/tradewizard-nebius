/**
 * Robust JSON extraction from LLM responses.
 *
 * Handles three extraction strategies in order of preference:
 * 1. Markdown code-fenced JSON (```json ... ```)
 * 2. Plain JSON parse of the full string
 * 3. Balanced-brace matching for embedded JSON objects
 *
 * Returns parsed object or null - never throws.
 *
 * Requirements: 10.5, 10.6
 */

/**
 * Extract JSON from an LLM response string.
 *
 * Strategies applied in order:
 * 1. If markdown code fences are present, extract content from ```json ... ``` blocks
 * 2. Try parsing the entire string as JSON
 * 3. Find the outermost balanced braces and parse that substring
 *
 * @param text - Raw text from LLM response
 * @returns Parsed object or null if no valid JSON found
 */
export function extractJson(text: string): Record<string, unknown> | null {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return null;
  }

  // Strategy 1: Markdown code-fenced JSON (preferred when present)
  const fencedJson = extractFromCodeFence(text);
  if (fencedJson !== null) {
    return fencedJson;
  }

  // Strategy 2: Try parsing the entire string as JSON
  const directParse = tryParse(text.trim());
  if (directParse !== null) {
    return directParse;
  }

  // Strategy 3: Balanced-brace matching
  const braceParse = extractFromBalancedBraces(text);
  if (braceParse !== null) {
    return braceParse;
  }

  return null;
}

/**
 * Extract JSON from markdown code fences.
 * Looks for ```json ... ``` or ``` ... ``` blocks.
 */
function extractFromCodeFence(text: string): Record<string, unknown> | null {
  // Match ```json\n...\n``` or ```\n...\n```
  const fenceRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(text)) !== null) {
    const content = match[1].trim();
    const parsed = tryParse(content);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

/**
 * Extract JSON using balanced brace matching.
 * Finds the first '{' and matches to its closing '}'.
 */
function extractFromBalancedBraces(text: string): Record<string, unknown> | null {
  const startIdx = text.indexOf('{');
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(startIdx, i + 1);
        return tryParse(candidate);
      }
    }
  }

  return null;
}

/**
 * Safely try to parse a string as JSON.
 * Returns the parsed object or null if parsing fails.
 */
function tryParse(text: string): Record<string, unknown> | null {
  try {
    const result = JSON.parse(text);
    if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
      return result as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
