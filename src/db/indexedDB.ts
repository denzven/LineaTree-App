import Dexie, { type Table } from 'dexie';

export interface TreeNode {
  id: string;
  type: 'INDIVIDUAL' | 'ASSOCIATE';
  name: string;
  chosenName?: string;
  sex: 'M' | 'F' | 'INTERSEX' | 'UNKNOWN';
  lifeStatus: 'ALIVE' | 'DECEASED' | 'MISSING';
  dob?: string;
  dod?: string;
  job?: string;
  company?: string;
  traits: string[];
  imageBlobId?: string;
  // Node coordinates (persisted so drag positions remain permanent)
  x?: number;
  y?: number;
}

export interface TreeEdge {
  id: string;
  source: string;
  target: string;
  type:
    | 'BIOLOGICAL_PARENT' | 'ADOPTIVE_PARENT' | 'FOSTER_PARENT' | 'STEP_PARENT'
    | 'SPOUSE' | 'FIANCE' | 'DIVORCED' | 'SEPARATED' | 'CONSANGUINOUS' | 'EX_PARTNER'
    | 'FRIEND' | 'BEST_FRIEND' | 'NEIGHBOR' | 'COWORKER' | 'COLLEAGUE' | 'CLASSMATE' | 'ESTRANGED';
}

export interface ImageAsset {
  id: string;
  blobData: string; // Base64 ultra-compressed image string
}

class LineaTreeDatabase extends Dexie {
  nodes!: Table<TreeNode, string>;
  edges!: Table<TreeEdge, string>;
  images!: Table<ImageAsset, string>;

  constructor() {
    super('LineaTreeDatabase');
    this.version(1).stores({
      nodes: 'id, type, sex, lifeStatus',
      edges: 'id, source, target, type',
      images: 'id'
    });
  }
}

export const db = new LineaTreeDatabase();
