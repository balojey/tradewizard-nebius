import { NextResponse } from "next/server";
import { GAMMA_API_URL } from "@/constants/api";

export async function GET() {
  try {
    // Fetch events with politics tag (id: 2) to get subcategories
    const response = await fetch(
      `${GAMMA_API_URL}/events?closed=false&tag_id=2&related_tags=true&limit=100&offset=0`,
      {
        headers: { "Content-Type": "application/json" },
        next: { revalidate: 300 }, // Cache for 5 minutes
      }
    );

    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.status}`);
    }

    const events = await response.json();

    if (!Array.isArray(events)) {
      return NextResponse.json(
        { error: "Invalid API response" },
        { status: 500 }
      );
    }

    // Extract all political subcategory tags
    const tagCounts: Record<string, { label: string; id: number; count: number }> = {};

    events.forEach((event: any) => {
      if (event.tags && Array.isArray(event.tags)) {
        event.tags.forEach((tag: any) => {
          // Skip the main "Politics" tag (id: 2) and focus on subcategories
          if (tag.id === 2 || tag.id === "2") return;
          
          const label = tag.label || tag.slug;
          if (!label) return;

          const tagId = parseInt(tag.id);
          if (isNaN(tagId)) return;

          if (!tagCounts[label]) {
            tagCounts[label] = { label, id: tagId, count: 0 };
          }
          tagCounts[label].count++;
        });
      }
    });

    // Sort by occurrence and take top categories
    const sortedCategories = Object.values(tagCounts)
      .filter(tag => tag.count >= 2) // Only include tags with at least 2 markets
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Take top 10 political subcategories

    return NextResponse.json(sortedCategories);
  } catch (error) {
    console.error("Error fetching political categories:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch categories",
      },
      { status: 500 }
    );
  }
}