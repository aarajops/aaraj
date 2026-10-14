const adminDateTimeFormat = new Intl.DateTimeFormat("en-BD", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dhaka",
});

export function formatAdminDateTime(value: string): string {
  return adminDateTimeFormat.format(new Date(value));
}
