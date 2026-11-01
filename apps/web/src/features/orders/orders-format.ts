export function humanize(value: string): string {
  return value
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function humanizeOrderStatus(status: string): string {
  if (status === "pending") return "Pending";
  if (status === "no_answer") return "No answer";
  return humanize(status);
}
