export interface MediaFile {
  id: string;
  name: string;
  url: string;
  size: number;
  type: string;
  createdAt: string;
  deletionState?: 'active' | 'pending';
}
