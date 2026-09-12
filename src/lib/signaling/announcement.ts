import { z } from "zod";


export const PAY_TO_MAX = 300;

export const manifestItemSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  kind: z.enum(["column", "dataset"]),
  tags: z.array(z.string().max(60)).max(20).default([]),
  summary: z.string().max(600).optional(),
  openProposals: z.number().int().min(0).max(100000).optional(),
});

export const announcementSchema = z.object({
  displayName: z.string().min(1).max(120),
  address: z
    .string()
    .url()
    .refine((value) => /^https?:/.test(value), "http(s) only"),
  payTo: z.string().max(PAY_TO_MAX).optional(),
  items: z.array(manifestItemSchema).max(500),
});

export type AnnouncementInput = z.infer<typeof announcementSchema>;

export function withinCapacity(
  announcement: AnnouncementInput,
  capacity: number,
): boolean {
  return announcement.items.length <= capacity;
}
