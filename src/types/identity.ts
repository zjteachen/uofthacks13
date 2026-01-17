export interface Identity {
  id: string;
  name: string;
  profilePicture: string; // Base64 or URL
  prompt: string;
  createdAt: number;
}

export interface IdentitiesStorage {
  identities: Identity[];
  selectedId?: string;
}
