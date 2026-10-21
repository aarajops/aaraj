const dateTimeFormat = new Intl.DateTimeFormat("en-BD", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

export function formatDateTime(value: string): string {
  return dateTimeFormat.format(new Date(value));
}
