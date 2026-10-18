"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import Form from "next/form";
import { usePathname, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  MAX_CATALOG_SEARCH_LENGTH,
  type CatalogCategoryOption,
} from "@aaraj/contracts";
import { cn } from "cn";

export function StorefrontSearchBar({
  categories,
  className,
}: {
  categories: CatalogCategoryOption[];
  className?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isCatalogPage = pathname === "/";
  const currentSearch = isCatalogPage ? (searchParams.get("search") ?? "") : "";
  const currentCategory = isCatalogPage
    ? (searchParams.get("category") ?? "")
    : "";

  return (
    <StorefrontSearchForm
      key={`${pathname}?${searchParams.toString()}`}
      categories={categories}
      className={className}
      currentCategory={currentCategory}
      currentSearch={currentSearch}
      preservedFilters={
        isCatalogPage
          ? (["audience", "color", "size"] as const).flatMap((name) => {
              const value = searchParams.get(name);
              return value ? [{ name, value }] : [];
            })
          : []
      }
    />
  );
}

function StorefrontSearchForm({
  categories,
  className,
  currentCategory,
  currentSearch,
  preservedFilters,
}: {
  categories: CatalogCategoryOption[];
  className?: string;
  currentCategory: string;
  currentSearch: string;
  preservedFilters: Array<{
    name: "audience" | "color" | "size";
    value: string;
  }>;
}) {
  const [search, setSearch] = useState(currentSearch);
  const [category, setCategory] = useState(currentCategory);
  const categoryItems = categories.map(({ id, path, slug }) => ({
    id,
    label: path,
    value: slug,
  }));

  return (
    <Form action="/" className={cn("flex min-w-0 flex-1", className)}>
      <InputGroup className="h-12 rounded-full !border-0 bg-muted !outline-none !ring-0 shadow-none focus-within:!border-0 focus-within:!outline-none focus-within:!ring-0 md:h-15 xl:h-8 2xl:h-10">
        <InputGroupInput
          aria-label="Search products"
          className="h-full px-3 text-base !outline-none !ring-0 placeholder:text-muted-foreground focus-visible:!outline-none focus-visible:!ring-0 md:px-5 md:text-xl xl:px-3 xl:text-xs 2xl:px-4 2xl:text-base"
          maxLength={MAX_CATALOG_SEARCH_LENGTH}
          name={search.trim() ? "search" : undefined}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search"
          type="search"
          value={search}
        />
        <InputGroupAddon align="inline-end" className="h-full gap-0 px-0">
          <Select
            items={[{ label: "Categories", value: null }, ...categoryItems]}
            name={category ? "category" : undefined}
            value={category || null}
            onValueChange={(value) =>
              setCategory(typeof value === "string" ? value : "")
            }
          >
            <SelectTrigger
              aria-label="Product category"
              className="h-full w-28 shrink-0 rounded-none !border-x !border-y-0 !border-background bg-transparent px-3 text-sm text-muted-foreground shadow-none !outline-none !ring-0 focus-visible:!border-background focus-visible:!outline-none focus-visible:!ring-0 sm:w-44 sm:text-base md:w-48 md:text-xl xl:w-28 xl:px-2 xl:text-xs 2xl:w-36 2xl:px-3 2xl:text-base"
            >
              <SelectValue placeholder="Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>Categories</SelectItem>
              {categoryItems.map(({ id, label, value }) => (
                <SelectItem key={id} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SearchSubmitButton />
        </InputGroupAddon>
      </InputGroup>
      {preservedFilters.map(({ name, value }) => (
        <input key={name} name={name} type="hidden" value={value} />
      ))}
    </Form>
  );
}

function SearchSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <InputGroupButton
      aria-label="Search"
      aria-busy={pending}
      className="!mr-0 h-full w-12 rounded-r-full !outline-none !ring-0 focus-visible:!outline-none focus-visible:!ring-0 md:w-14 xl:w-10 2xl:w-12"
      size="icon-sm"
      type="submit"
    >
      {pending ? (
        <Spinner aria-label="Searching products" className="size-5" />
      ) : (
        <Search aria-hidden="true" className="size-5" />
      )}
    </InputGroupButton>
  );
}
