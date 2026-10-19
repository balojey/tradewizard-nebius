import { useQuery } from "@tanstack/react-query";
import { BASE_CATEGORIES, createCategoryFromSubcategory, type Category, type PoliticalSubcategory } from "@/constants/categories";

export interface CategoriesResult {
  base: Category[];
  related: Category[];
}

export default function usePoliticalCategories() {
  return useQuery({
    queryKey: ["market-categories"],
    queryFn: async (): Promise<CategoriesResult> => {
      try {
        const response = await fetch("/api/polymarket/related-tags");

        if (!response.ok) {
          return { base: BASE_CATEGORIES, related: [] };
        }

        const relatedTags: PoliticalSubcategory[] = await response.json();
        const relatedCategories = relatedTags.map(createCategoryFromSubcategory);

        return { base: BASE_CATEGORIES, related: relatedCategories };
      } catch (error) {
        console.warn("Failed to fetch related tags:", error);
        return { base: BASE_CATEGORIES, related: [] };
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 10 * 60 * 1000, // Refetch every 10 minutes
    refetchOnWindowFocus: false,
  });
}