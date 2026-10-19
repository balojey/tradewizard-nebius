import { NextResponse } from "next/server";
import { GAMMA_API_URL } from "@/constants/api";

// Base tag IDs to fetch related tags for
const BASE_TAG_IDS = [2, 21, 84, 120, 144, 596, 1401, 100265, 100328];

export async function GET() {
  try {
    // Fetch events from all base tags in parallel to discover related sub-tags
    const fetches = BASE_TAG_IDS.map(async (baseTagId) => {
      const resp = await fetch(
        `${GAMMA_API_URL}/events?closed=false&tag_id=${baseTagId}&related_tags=true&limit=50&offset=0`,
        {
          headers: { "Content-Type": "application/json" },
          next: { revalidate: 300 }, // Cache for 5 minutes
        }
      );
      if (!resp.ok) return { baseTagId, events: [] };
      const data = await resp.json();
      return { baseTagId, events: Array.isArray(data) ? data : [] };
    });

    const results = await Promise.all(fetches);

    // Count tag occurrences across all events, excluding base tags themselves
    const baseTagIdSet = new Set(BASE_TAG_IDS.map(String));
    const tagCounts: Record<string, { label: string; id: number; count: number }> = {};

    for (const { events } of results) {
      for (const event of events) {
        if (!event.tags || !Array.isArray(event.tags)) continue;

        for (const tag of event.tags) {
          const tagId = String(tag.id);

          // Skip base category tags - we only want sub-tags
          if (baseTagIdSet.has(tagId)) continue;

          const label = tag.label || tag.slug;
          if (!label) continue;

          const numericId = parseInt(tagId);
          if (isNaN(numericId)) continue;

          if (!tagCounts[tagId]) {
            tagCounts[tagId] = { label, id: numericId, count: 0 };
          }
          tagCounts[tagId].count++;
        }
      }
    }

    // Sort by occurrence and return top related tags
    const relatedTags = Object.values(tagCounts)
      .filter((tag) => tag.count >= 3) // At least 3 markets to be worth showing
      .sort((a, b) => b.count - a.count)
      .slice(0, 20); // Top 20 related sub-tags

    return NextResponse.json(relatedTags);
  } catch (error) {
    console.error("Error fetching related tags:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch related tags",
      },
      { status: 500 }
    );
  }
}
