"use client";

import type { CatalogCategory } from "@aaraj/contracts";
import type { Ref } from "react";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const fieldClassName =
  "h-auto w-full rounded-md border border-input bg-background px-3 py-2.5 text-base text-foreground md:text-base";

export function CatalogCategorySelect({
  id,
  label,
  value,
  categories,
  allowParentCategories = false,
  required = false,
  errorMessage,
  name,
  triggerRef,
  onBlur,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  categories: CatalogCategory[];
  allowParentCategories?: boolean;
  required?: boolean;
  errorMessage?: string;
  name?: string;
  triggerRef?: Ref<HTMLButtonElement>;
  onBlur?: () => void;
  onChange: (categoryId: string) => void;
}) {
  const assignableCategories = categories.filter(
    ({ isActive, isLeaf }) => isActive && (allowParentCategories || isLeaf),
  );
  const emptyLabel = assignableCategories.length
    ? "Choose a category"
    : allowParentCategories
      ? "No active categories available"
      : "No active product categories available";

  return (
    <Field>
      <FieldLabel id={`${id}-label`} htmlFor={id}>
        {label}
      </FieldLabel>
      <Select
        disabled={categories.length === 0}
        items={[
          { label: emptyLabel, value: null },
          ...categories.map((category) => ({
            label: category.isActive
              ? category.path
              : `${category.path} (inactive)`,
            value: category.id,
            disabled:
              !category.isActive ||
              (!allowParentCategories && !category.isLeaf),
          })),
        ]}
        name={name}
        required={required}
        value={value || null}
        onValueChange={(selectedValue) =>
          onChange(typeof selectedValue === "string" ? selectedValue : "")
        }
      >
        <SelectTrigger
          className={fieldClassName}
          id={id}
          aria-labelledby={`${id}-label`}
          aria-describedby={errorMessage ? `${id}-error` : undefined}
          aria-invalid={Boolean(errorMessage)}
          ref={triggerRef}
          onBlur={onBlur}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={null}>{emptyLabel}</SelectItem>
          {categories.map((category) => (
            <SelectItem
              key={category.id}
              value={category.id}
              disabled={
                !category.isActive ||
                (!allowParentCategories && !category.isLeaf)
              }
            >
              {category.isActive
                ? category.path
                : `${category.path} (inactive)`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {errorMessage && (
        <FieldError id={`${id}-error`}>{errorMessage}</FieldError>
      )}
      {assignableCategories.length === 0 && (
        <FieldDescription>
          {allowParentCategories
            ? "An administrator needs to add an active category before this guide can be assigned."
            : "An administrator needs to add an active leaf category before this product can be assigned."}
        </FieldDescription>
      )}
      {!allowParentCategories && assignableCategories.length > 0 && (
        <FieldDescription>
          Choose an active leaf category. Parent categories are shown for
          context.
        </FieldDescription>
      )}
      {allowParentCategories && assignableCategories.length > 0 && (
        <FieldDescription>
          A guide is available for products in this category and its
          subcategories.
        </FieldDescription>
      )}
    </Field>
  );
}
