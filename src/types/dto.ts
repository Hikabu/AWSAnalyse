/** Product data parsed from a category/search page. */
export interface ProductDto {
  asin: string;
  title: string;
  price: number | null;
  rating: number | null;
  reviewCount: number | null;
  imageUrl: string | null;
  categorySlug: string;
  url: string;
}

/** Single review from a product-reviews page. */
export interface ReviewDto {
  id: string;
  productId: string;
  author: string | null;
  rating: number;
  title: string | null;
  body: string | null;
  date: Date | null;
  verified: boolean;
}
