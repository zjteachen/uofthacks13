export interface Characteristic {
  id: string;
  name: string;
  value: string;
}

export interface Identity {
  id: string;
  name: string;
  profilePicture: string; // Base64 or URL
  prompt: string;
  characteristics: Characteristic[];
  createdAt: number;
}

export interface IdentitiesStorage {
  identities: Identity[];
  selectedId?: string;
}
