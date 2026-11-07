import { z } from "zod";

export const CheckoutAddressInputSchema = z.strictObject({
  recipientName: z
    .string()
    .trim()
    .min(2, { error: "Enter at least 2 characters." })
    .max(120, { error: "Use 120 characters or fewer." }),
  phone: z
    .string()
    .trim()
    .min(6, { error: "Enter your mobile number." })
    .max(32, { error: "Use 32 characters or fewer." }),
  geographyVersion: z.string().trim().min(1).max(80),
  divisionId: z.uuid(),
  districtId: z.uuid(),
  upazilaId: z.uuid().optional(),
  doorstepDetails: z
    .string()
    .trim()
    .min(3, { error: "Enter your delivery address." })
    .max(400, { error: "Use 400 characters or fewer." }),
  street: z.string().trim().max(160).optional(),
  house: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(20).optional(),
  instructions: z.string().trim().max(400).optional(),
});
export type CheckoutAddressInput = z.infer<typeof CheckoutAddressInputSchema>;
