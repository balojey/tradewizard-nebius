export type CategoryId = string;

export interface Category {
  id: CategoryId;
  label: string;
  tagId: number | null;
}

export interface PoliticalSubcategory {
  label: string;
  id: number;
  count: number;
}

// Base categories - "All" shows everything, then top-level tags
export const BASE_CATEGORIES: Category[] = [
  {
    id: "all",
    label: "All",
    tagId: null, // No tag filter - shows all markets
  },
  {
    id: "trending",
    label: "Trending",
    tagId: null, // No tag filter - sorted by volume (trending logic)
  },
  {
    id: "crypto",
    label: "Crypto",
    tagId: 21,
  },
  {
    id: "politics",
    label: "Politics",
    tagId: 2,
  },
  {
    id: "elections",
    label: "Elections",
    tagId: 144,
  },
  {
    id: "finance",
    label: "Finance",
    tagId: 120,
  },
  {
    id: "economy",
    label: "Economy",
    tagId: 100328,
  },
  {
    id: "tech",
    label: "Tech",
    tagId: 1401,
  },
  {
    id: "geopolitics",
    label: "Geopolitics",
    tagId: 100265,
  },
  {
    id: "culture",
    label: "Culture",
    tagId: 596,
  },
  {
    id: "weather",
    label: "Weather",
    tagId: 84,
  },
];

export const DEFAULT_CATEGORY: CategoryId = "trending";

export function getCategoryById(id: CategoryId, categories: Category[]): Category | undefined {
  return categories.find((c) => c.id === id);
}

// Helper to create category from dynamic subcategory
export function createCategoryFromSubcategory(subcategory: PoliticalSubcategory): Category {
  return {
    id: subcategory.label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
    label: subcategory.label,
    tagId: subcategory.id,
  };
}

