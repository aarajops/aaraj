import type { Metadata } from "next";
import { CategoryManager } from "@/features/catalog/category-manager";

export const metadata: Metadata = {
  title: "Product categories",
  description: "Manage product categories in the Aaraj catalog.",
};

export default function StaffCatalogCategoriesPage() {
  return <CategoryManager />;
}
