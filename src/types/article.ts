export interface Article {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  author_id: string;
  published: boolean;
  created_at: string;
  updated_at: string;
}
