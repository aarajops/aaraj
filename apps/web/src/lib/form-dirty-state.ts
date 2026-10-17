export function hasDirtyFieldsExcept(
  dirtyFields: unknown,
  ignoredFields: readonly string[],
): boolean {
  if (typeof dirtyFields !== "object" || dirtyFields === null) return false;

  const ignored = new Set(ignoredFields);
  return Object.entries(dirtyFields).some(
    ([field, dirty]) => !ignored.has(field) && containsDirtyField(dirty),
  );
}

function containsDirtyField(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).some(containsDirtyField);
}
